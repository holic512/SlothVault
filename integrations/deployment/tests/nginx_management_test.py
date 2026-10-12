"""Nginx source preservation, discovery and transactional update regressions."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from slothvault_deploy.nginx_config import Configuration, loaded_sources, parse, patch_server, transfer_status
from slothvault_deploy.nginx_discovery import Instance, application_endpoints, compile_paths, context_arguments, discover, docker_instances
from slothvault_deploy.nginx_management import apply_updates, write_site
from slothvault_deploy.nginx import DockerMount, DockerNginxManager, SystemNginxManager, NginxProxyConfig, render_https_proxy_config
from slothvault_deploy.system import InstallerError


SITE = '''# preserve user comment
server {
    listen 443 ssl;
    server_name vault.example.com;
    ssl_certificate /cert/fullchain.pem;
    ssl_certificate_key /cert/private.pem;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Custom "a;#{}";
        auth_basic "private vault";
        auth_basic_user_file /secret/htpasswd;
    }
}
'''
OTHER = '''server { listen 8443 ssl; server_name other.example.com;
location / { proxy_pass http://other:3000; } }
'''


def configuration(site=SITE, http='client_max_body_size 2m;'):
    return Configuration({'/etc/nginx/nginx.conf': 'events {} http { ' + http + ' include conf.d/*.conf; }',
                          '/etc/nginx/conf.d/shared.conf': SITE.replace(SITE, site) + OTHER}, '/etc/nginx/nginx.conf', '/usr/share/nginx')


class PolicyTests(unittest.TestCase):
    def test_parser_retains_quotes_comments_variables_and_source_offsets(self):
        source = '# ignore { }\nhttp { log_format x "a;#{}"; set $x ${name}; }'
        node = parse(source)[0]
        self.assertEqual(node.words, ('http',))
        self.assertEqual(node.children[0].words, ('log_format', 'x', 'a;#{}'))
        self.assertEqual(source[node.children[1].start:node.children[1].end], 'set $x ${name};')
        with self.assertRaises(InstallerError):
            parse('http { server {')

    def test_loaded_include_and_multisite_patch_preserve_https_auth_headers_and_other_site(self):
        config = configuration()
        origin, node, inherited = config.servers()[0]
        self.assertEqual(inherited['client_max_body_size'], '2m')
        source, changes = patch_server(config, origin, node, inherited)
        self.assertTrue(source.endswith(OTHER))
        for line in SITE.splitlines():
            if line.strip() not in ('}', ''):
                self.assertIn(line, source)
        self.assertIn('client_max_body_size 0;', source)
        self.assertIn('client_max_body_size 25m;', source)
        self.assertIn('client_max_body_size 100m;', source)
        self.assertIn('proxy_max_temp_file_size 0;', source)
        self.assertTrue(changes)
        after = Configuration({**config.sources, origin: source}, config.main)
        origin, node, inherited = after.servers()[0]
        again, changes = patch_server(after, origin, node, inherited)
        self.assertEqual(again, source)
        self.assertEqual(changes, [])
        status = transfer_status(after, origin, node, inherited)
        self.assertEqual(status[0]['routes'][0]['clientMaxBodySize'], '0')

    def test_higher_or_unlimited_inherited_limit_and_longer_timeouts_are_preserved(self):
        for limit in ('200m', '0'):
            config = configuration(http=f'client_max_body_size {limit}; proxy_read_timeout 2h;')
            origin, node, inherited = config.servers()[0]
            source, changes = patch_server(config, origin, node, inherited)
            self.assertNotIn('client_max_body_size 25m;', source)
            self.assertNotIn('client_max_body_size 100m;', source)
            self.assertNotIn('proxy_read_timeout 3600s;', source)

    def test_unsafe_rewrite_regex_uri_replacement_or_shared_location_are_rejected(self):
        for site in (SITE.replace('location / {', 'location / { rewrite ^ /else break;'),
                     SITE.replace('location / {', 'location ~ ^/ {'),
                     SITE.replace('http://127.0.0.1:3000;', 'http://127.0.0.1:3000/base/;')):
            config = configuration(site)
            origin, node, inherited = config.servers()[0]
            with self.assertRaises(InstallerError):
                patch_server(config, origin, node, inherited)
        config = Configuration({'/main.conf': 'http { server { include /shared.conf; } }', '/shared.conf': 'location / { proxy_pass http://app:3000; }'}, '/main.conf')
        origin, node, inherited = config.servers()[0]
        with self.assertRaises(InstallerError):
            patch_server(config, origin, node, inherited)

    def test_generated_https_has_transfer_rules_only_in_proxy_server(self):
        proxy = NginxProxyConfig('nginx', Path('/tmp/vault.conf'), None, ('vault.example.com',), 3000)
        source = render_https_proxy_config(proxy, Path('/acme'))
        self.assertEqual(source.count('SlothVault transfer policy: backup-upload'), 1)
        self.assertIn('return 301 https://$host$request_uri;', source)


class DiscoveryTests(unittest.TestCase):
    def test_custom_main_prefix_and_application_endpoints(self):
        arguments = context_arguments(['nginx', '-p', '/srv/nginx', '-c', 'conf/main.conf', '-g', 'daemon off;'])
        self.assertEqual(compile_paths('nginx version: nginx/1.28\nconfigure arguments: --prefix=/usr/share/nginx --conf-path=/etc/nginx/nginx.conf', arguments), ('/srv/nginx/conf/main.conf', '/srv/nginx'))
        endpoints = application_endpoints(3100, {'NetworkSettings': {'Networks': {'app': {'Aliases': ['vault'], 'IPAddress': '172.20.0.3'}}}})
        self.assertIn('vault:3000', endpoints)
        self.assertIn('127.0.0.1:3100', endpoints)

    def test_docker_custom_image_with_directory_or_single_file_bind_is_identified(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'vault.conf').write_text(SITE)
            dump = '# configuration file /etc/nginx/nginx.conf:\nevents {} http { include /etc/nginx/conf.d/*.conf; }\n# configuration file /etc/nginx/conf.d/vault.conf:\n' + SITE
            record = {'Name': '/custom', 'Config': {'Image': 'custom/private-proxy'}, 'State': {'Running': True},
                      'Mounts': [{'Type': 'bind', 'Source': directory, 'Destination': '/etc/nginx/conf.d'}]}
            def run(command, **options):
                if 'inspect' in command:
                    stdout = json.dumps([record])
                elif command[-1] == '-V':
                    stdout = 'nginx version: nginx/1.28\nconfigure arguments: --conf-path=/etc/nginx/nginx.conf'
                elif command[-1] == '-T':
                    stdout = dump
                elif command[-1] == '/proc/1/cmdline':
                    stdout = 'nginx: master process nginx -g daemon off;\x00'
                else:
                    stdout = ''
                return subprocess.CompletedProcess(command, 0, stdout, '')
            with patch('slothvault_deploy.nginx_discovery.shutil.which', return_value='docker'), patch('slothvault_deploy.nginx_discovery.output', side_effect=run):
                instance = docker_instances('custom')[0]
                self.assertIsNotNone(instance.config)
                self.assertEqual(instance.host_path('/etc/nginx/conf.d/vault.conf'), ((root / 'vault.conf').resolve(), False))
                record['Mounts'][0].update(Source=str(root / 'vault.conf'), Destination='/etc/nginx/conf.d/vault.conf')
                instance = docker_instances('custom')[0]
                self.assertEqual(instance.host_path('/etc/nginx/conf.d/vault.conf'), ((root / 'vault.conf').resolve(), True))
                record['State']['Running'] = False
                self.assertEqual(docker_instances('custom')[0].error, 'NOT_RUNNING')

    def test_named_upstream_matches_application_but_not_other_sites(self):
        config = configuration(SITE.replace('127.0.0.1:3000', 'vault_backend'), 'upstream vault_backend { server 127.0.0.1:3000; }')
        instance = Instance(SystemNginxManager('nginx', Path('/etc/nginx/nginx.conf'), None), True, config=config)
        with patch('slothvault_deploy.nginx_discovery.host_instances', return_value=[instance]), patch('slothvault_deploy.nginx_discovery.docker_instances', return_value=[]):
            _, sites = discover('auto', None, None, {'127.0.0.1:3000'})
        self.assertEqual([site.matched for site in sites], [True, False])


class TransactionTests(unittest.TestCase):
    def fixture(self, root):
        path = root / 'vault.conf'
        path.write_text(SITE + OTHER)
        path.chmod(0o640)
        main = str(root / 'nginx.conf')
        (root / 'nginx.conf').write_text('events {} http { include ' + str(path) + '; }')
        config = Configuration({str(path): path.read_text(), main: (root / 'nginx.conf').read_text()}, main)
        manager = SystemNginxManager('nginx', path, None)
        instance = Instance(manager, True, main, config=config)
        origin, node, inherited = config.servers()[0]
        new, _ = patch_server(config, origin, node, inherited)
        return path, instance, new

    def test_backup_permissions_success_noop_and_stale_preview(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path, instance, new = self.fixture(root)
            def run(command):
                dump = '# configuration file ' + str(path) + ':\n' + path.read_text()
                return subprocess.CompletedProcess(command, 0, dump if command[-1] == '-T' else '', '')
            with patch('slothvault_deploy.nginx_management.output', side_effect=run) as command:
                backup = apply_updates(root, instance, {str(path): new})
                self.assertEqual(path.stat().st_mode & 0o777, 0o640)
                self.assertEqual((backup / '0.conf').stat().st_mode & 0o777, 0o600)
                self.assertEqual((backup / '0.conf').read_text(), SITE + OTHER)
                self.assertTrue(path.read_text().endswith(OTHER))
                with self.assertRaisesRegex(InstallerError, '变化'):
                    apply_updates(root, instance, {str(path): new})
                self.assertEqual(command.call_count, 3)

    def test_failed_syntax_or_reload_restores_original_and_reports_failed_rollback(self):
        for fail_at, rollback_fails in ((1, False), (3, False), (1, True)):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                path, instance, new = self.fixture(root)
                count = 0
                def run(command):
                    nonlocal count
                    count += 1
                    if count == fail_at or rollback_fails:
                        raise InstallerError('injected failure')
                    dump = '# configuration file ' + str(path) + ':\n' + path.read_text()
                    return subprocess.CompletedProcess(command, 0, dump if command[-1] == '-T' else '', '')
                with patch('slothvault_deploy.nginx_management.output', side_effect=run):
                    with self.assertRaisesRegex(InstallerError, '回滚未完成' if rollback_fails else '原配置已恢复'):
                        apply_updates(root, instance, {str(path): new})
                self.assertEqual(path.read_text(), SITE + OTHER)

    def test_single_file_mount_write_retains_inode(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'file.conf'
            path.write_text('old')
            info = path.stat()
            write_site(path, 'new', info, True)
            self.assertEqual(path.stat().st_ino, info.st_ino)
            self.assertEqual(path.read_text(), 'new')

    def test_cancelled_write_rolls_back_and_keeps_cancel_outcome(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path, instance, new = self.fixture(root)
            with patch('slothvault_deploy.nginx_management.output', side_effect=[KeyboardInterrupt(),
                       subprocess.CompletedProcess([], 0, '', ''), subprocess.CompletedProcess([], 0, '', '')]):
                with self.assertRaises(KeyboardInterrupt):
                    apply_updates(root, instance, {str(path): new})
            self.assertEqual(path.read_text(), SITE + OTHER)

    def test_missing_loaded_file_rolls_back_and_noop_avoids_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path, instance, new = self.fixture(root)
            with patch('slothvault_deploy.nginx_management.output') as command:
                self.assertIsNone(apply_updates(root, instance, {str(path): path.read_text()}))
                command.assert_not_called()
            good = subprocess.CompletedProcess([], 0, '', '')
            dump = subprocess.CompletedProcess([], 0, '# configuration file /different.conf:\nevents {}', '')
            with patch('slothvault_deploy.nginx_management.output', side_effect=[good, dump, good, good]):
                with self.assertRaisesRegex(InstallerError, '原配置已恢复'):
                    apply_updates(root, instance, {str(path): new})
            self.assertEqual(path.read_text(), SITE + OTHER)


if __name__ == '__main__':
    unittest.main()
