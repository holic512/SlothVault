"""Standard-library regression tests for the release deployment package."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEPLOY_ROOT = REPOSITORY_ROOT / "deploy"
sys.path.insert(0, str(DEPLOY_ROOT))

from slothvault_deploy import certbot, cli, compose, nginx, release  # noqa: E402
from slothvault_deploy.system import InstallerError  # noqa: E402


class ComposeRenderingTests(unittest.TestCase):
    def test_sqlite_loopback_rendering_keeps_private_data_contract(self) -> None:
        config = compose.DeploymentConfig(
            root=Path("/data/slothvault"),
            data_dir=Path("/data/slothvault/data"),
            provider="sqlite",
            image="holic512/slothvault:latest",
            port=3000,
            bind_loopback=True,
        )
        source = compose.render_compose(config)

        self.assertIn(compose.MANAGED_COMPOSE_MARKER, source)
        self.assertIn('"127.0.0.1:3000:3000"', source)
        self.assertIn('"/data/slothvault/data:/app/data"', source)

    def test_legacy_compose_marker_remains_operable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            compose_path = Path(directory) / "compose.yml"
            compose_path.write_text(
                "# Managed by SlothVault install.py\nservices: {}\n", encoding="utf-8"
            )
            compose.require_managed_compose(compose_path)


class ReleaseUpdateTests(unittest.TestCase):
    class Response:
        def __init__(self, payload):
            self.payload = payload

        def read(self):
            import json

            return json.dumps(self.payload).encode("utf-8")

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

    @staticmethod
    def release_payload(tag, notes=""):
        return {
            "tag_name": tag,
            "name": "SlothVault {0}".format(tag),
            "target_commitish": "{0}-sha".format(tag),
            "published_at": "2026-08-31T00:00:00.000Z",
            "html_url": "https://github.com/holic512/SlothVault/releases/tag/{0}".format(tag),
            "body": notes,
            "draft": False,
            "prerelease": False,
        }

    def managed_root(self):
        directory = tempfile.TemporaryDirectory()
        root = Path(directory.name)
        (root / "compose.yml").write_text(
            "# Managed by SlothVault deploy installer\nservices:\n  slothvault:\n    image: \"holic512/slothvault:latest\"\n",
            encoding="utf-8",
        )
        return directory, root

    def test_release_tags_compare_semver_before_build_number(self):
        current = release.parse_release_tag("v2.0.0-build.75")
        newer_build = release.parse_release_tag("v2.0.0-build.76")
        newer_minor = release.parse_release_tag("v2.1.0-build.1")

        self.assertIsNotNone(current)
        self.assertEqual(release.compare_release_versions(newer_build, current), 1)
        self.assertEqual(release.compare_release_versions(newer_minor, newer_build), 1)
        self.assertIsNone(release.parse_release_tag("v2.0-build.76"))

    def test_selects_only_the_adjacent_release_when_multiple_newer_releases_exist(self):
        payload = [
            self.release_payload("v2.0.0-build.77", "newest"),
            self.release_payload("v2.0.0-build.76", "middle"),
            self.release_payload("v2.0.0-build.75", "installed"),
            {**self.release_payload("v2.0.0-build.78"), "prerelease": True},
        ]

        releases = release.fetch_published_releases(
            "holic512/SlothVault",
            "v2.0.0-build.75",
            opener=lambda request, timeout: self.Response(payload),
        )

        self.assertEqual([item.tag for item in releases], ["v2.0.0-build.77", "v2.0.0-build.76", "v2.0.0-build.75"])
        current = release.parse_release_tag("v2.0.0-build.75")
        self.assertIsNotNone(current)
        next_release = release.next_release_after(current, releases)
        self.assertIsNotNone(next_release)
        self.assertEqual(next_release.tag, "v2.0.0-build.76")
        self.assertEqual(next_release.notes, "middle")

    def test_reads_application_identity_only_from_the_managed_container(self):
        tag, commit_sha, image = release.application_identity({
            "Config": {
                "Image": "holic512/slothvault:latest",
                "Env": ["SLOTHVAULT_RELEASE_TAG=v2.0.0-build.76", "SLOTHVAULT_RELEASE_COMMIT_SHA=abc123"],
                "Labels": {},
            }
        })

        self.assertEqual((tag, commit_sha, image), ("v2.0.0-build.76", "abc123", "holic512/slothvault:latest"))
        self.assertTrue(release.is_official_image(image))
        self.assertFalse(release.is_official_image("example.com/custom/slothvault:latest"))

    def test_update_requires_confirmation_and_rechecks_target_release(self):
        package, root = self.managed_root()
        try:
            next_release = release.PublishedRelease(
                tag="v2.0.0-build.76",
                title="SlothVault v2.0.0-build.76",
                commit_sha="next-sha",
                published_at=None,
                html_url="https://github.com/holic512/SlothVault/releases/tag/v2.0.0-build.76",
                notes="- `abc` update",
            )
            initial = release.DeploymentUpdateCheck(
                repository="holic512/SlothVault",
                script_tag="v2.0.0-build.76",
                script_commit_sha="latest-sha",
                application_tag="v2.0.0-build.75",
                application_commit_sha="previous-sha",
                application_image="holic512/slothvault:latest",
                next_application_release=next_release,
                next_script_release=None,
                history_complete=True,
                status="APPLICATION_UPDATE_AVAILABLE",
                error=None,
                application_update_available=True,
                script_update_available=False,
            )
            verified = release.DeploymentUpdateCheck(
                **{**initial.__dict__, "application_tag": next_release.tag, "status": "UP_TO_DATE", "next_application_release": None, "application_update_available": False}
            )
            with patch.object(release, "check_deployment_update", side_effect=[initial, verified]), patch.object(
                release, "prompt_yes_no", return_value=True
            ), patch.object(compose, "run_command") as validate_compose, patch.object(release, "run_command") as run_command:
                release.update_managed_application(root)

            self.assertEqual(
                [call[0][0] for call in run_command.call_args_list],
                [
                    ("docker", "compose", "-f", str(root / "compose.yml"), "pull"),
                    ("docker", "compose", "-f", str(root / "compose.yml"), "up", "-d"),
                    ("docker", "compose", "-f", str(root / "compose.yml"), "ps"),
                ],
            )
            validate_compose.assert_called_once_with(("docker", "compose", "-f", str(root / "compose.yml"), "config"))
            self.assertIn('image: "holic512/slothvault:v2.0.0-build.76"', (root / "compose.yml").read_text(encoding="utf-8"))
        finally:
            package.cleanup()

    def test_current_release_does_not_pull_or_restart(self):
        package, root = self.managed_root()
        try:
            current = release.DeploymentUpdateCheck(
                repository="holic512/SlothVault",
                script_tag="v2.0.0-build.76",
                script_commit_sha="latest-sha",
                application_tag="v2.0.0-build.76",
                application_commit_sha="latest-sha",
                application_image="holic512/slothvault:latest",
                next_application_release=None,
                next_script_release=None,
                history_complete=True,
                status="UP_TO_DATE",
                error=None,
                application_update_available=False,
                script_update_available=False,
            )
            with patch.object(release, "check_deployment_update", return_value=current), patch.object(
                release, "run_command"
            ) as run_command:
                release.update_managed_application(root)

            run_command.assert_not_called()
        finally:
            package.cleanup()

    def test_unverifiable_release_does_not_fall_back_to_the_latest_image(self):
        package, root = self.managed_root()
        try:
            unknown = release.DeploymentUpdateCheck(
                repository="holic512/SlothVault",
                script_tag="v2.0.0-build.76",
                script_commit_sha="latest-sha",
                application_tag=None,
                application_commit_sha=None,
                application_image="holic512/slothvault:latest",
                next_application_release=None,
                next_script_release=None,
                history_complete=False,
                status="UNVERIFIABLE",
                error=None,
                application_update_available=False,
                script_update_available=False,
            )
            with patch.object(release, "check_deployment_update", return_value=unknown), patch.object(
                release, "run_command"
            ) as run_command:
                release.update_managed_application(root)

            run_command.assert_not_called()
            self.assertIn('image: "holic512/slothvault:latest"', (root / "compose.yml").read_text(encoding="utf-8"))
        finally:
            package.cleanup()


class NginxRenderingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.proxy = nginx.NginxProxyConfig(
            executable="nginx",
            config_path=Path("/etc/nginx/conf.d/slothvault.conf"),
            enabled_path=None,
            server_names=("vault.example.com", "www.vault.example.com"),
            upstream_port=3000,
        )

    def test_https_config_keeps_acme_path_and_proxy_headers(self) -> None:
        source = nginx.render_https_proxy_config(
            self.proxy, Path("/data/slothvault/acme-challenge")
        )

        self.assertIn("listen 80;", source)
        self.assertIn("listen 443 ssl;", source)
        self.assertIn("location ^~ /.well-known/acme-challenge/", source)
        self.assertIn("return 301 https://$host$request_uri;", source)
        self.assertIn("/etc/letsencrypt/live/vault.example.com/fullchain.pem", source)
        self.assertIn("proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;", source)
        self.assertIn("proxy_pass http://127.0.0.1:3000;", source)

    def test_unmanaged_nginx_file_is_never_accepted_for_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "slothvault.conf"
            path.write_text("server {}\n", encoding="utf-8")
            proxy = nginx.NginxProxyConfig(
                executable="nginx",
                config_path=path,
                enabled_path=None,
                server_names=("vault.example.com",),
                upstream_port=3000,
            )
            with self.assertRaises(InstallerError):
                nginx.snapshot_nginx_site(proxy)


class SystemNginxManagerTests(unittest.TestCase):
    def test_system_site_path_contract_supports_standard_paths_and_rejects_missing_directories(self) -> None:
        def standard_directories(path):
            return str(path) in {"/etc/nginx/sites-available", "/etc/nginx/sites-enabled"}

        with patch.object(nginx.Path, "is_dir", new=standard_directories):
            config_path, enabled_path = nginx.nginx_site_paths()
        self.assertEqual(config_path, Path("/etc/nginx/sites-available/slothvault.conf"))
        self.assertEqual(enabled_path, Path("/etc/nginx/sites-enabled/slothvault.conf"))

        with patch.object(nginx.Path, "is_dir", return_value=False):
            with self.assertRaisesRegex(InstallerError, "未找到受支持"):
                nginx.nginx_site_paths()

    def test_standard_sites_available_manager_enables_only_its_site(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            available = root / "sites-available"
            enabled = root / "sites-enabled"
            available.mkdir()
            enabled.mkdir()
            manager = nginx.SystemNginxManager("/usr/sbin/nginx", available / "slothvault.conf", enabled / "slothvault.conf")
            proxy = manager.proxy_config(3000, ("vault.example.com",))
            with patch.object(manager, "validate_site"), patch.object(manager, "reload"):
                nginx.apply_nginx_site(proxy, nginx.render_http_proxy_config(proxy))

            self.assertTrue(proxy.config_path.is_file())
            self.assertTrue(proxy.enabled_path.is_symlink())
            self.assertEqual(proxy.enabled_path.resolve(), proxy.config_path.resolve())

    def test_standard_conf_d_manager_does_not_create_enable_link(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "conf.d" / "slothvault.conf"
            config_path.parent.mkdir()
            manager = nginx.SystemNginxManager("/usr/sbin/nginx", config_path, None)
            proxy = manager.proxy_config(3000, ("vault.example.com",))
            with patch.object(manager, "validate_site"), patch.object(manager, "reload"):
                nginx.apply_nginx_site(proxy, nginx.render_http_proxy_config(proxy))

            self.assertTrue(config_path.is_file())
            self.assertIsNone(proxy.enabled_path)

    def test_baota_or_panel_nginx_is_rejected_before_writing_standard_paths(self) -> None:
        with self.assertRaisesRegex(InstallerError, "不支持宝塔"):
            nginx.ensure_supported_system_nginx("/www/server/nginx/sbin/nginx")


class DockerNginxManagerTests(unittest.TestCase):
    def docker_inspect(self, mounts=None, image="nginx:alpine", running=True, networks=None):
        return {
            "State": {"Running": running},
            "Config": {"Image": image},
            "Mounts": mounts or [],
            "NetworkSettings": {"Networks": networks or {"slothvault_default": {}}},
        }

    def discover(self, inspect):
        return patch.object(nginx.shutil, "which", return_value="/usr/bin/docker"), patch.object(
            nginx, "_docker_container_inspect", return_value=inspect
        ), patch.object(nginx.DockerNginxManager, "validate_syntax")

    def test_missing_docker_container_is_reported(self) -> None:
        with patch.object(nginx.shutil, "which", return_value="/usr/bin/docker"), patch.object(
            nginx, "_docker_container_inspect", side_effect=InstallerError("Docker Nginx 容器不存在")
        ):
            with self.assertRaisesRegex(InstallerError, "不存在"):
                nginx.DockerNginxManager.discover("nginx")

    def test_stopped_and_non_official_containers_are_rejected(self) -> None:
        stopped = self.docker_inspect(running=False)
        with patch.object(nginx.shutil, "which", return_value="/usr/bin/docker"), patch.object(
            nginx, "_docker_container_inspect", return_value=stopped
        ):
            with self.assertRaisesRegex(InstallerError, "未运行"):
                nginx.DockerNginxManager.discover("nginx")

        non_official = self.docker_inspect(image="baota/nginx:latest")
        with patch.object(nginx.shutil, "which", return_value="/usr/bin/docker"), patch.object(
            nginx, "_docker_container_inspect", return_value=non_official
        ):
            with self.assertRaisesRegex(InstallerError, "仅支持官方"):
                nginx.DockerNginxManager.discover("nginx")

    def test_docker_mode_requires_a_confirmed_configuration_bind_mount(self) -> None:
        inspect = self.docker_inspect(mounts=[{"Type": "volume", "Source": "nginx", "Destination": "/etc/nginx/conf.d"}])
        with patch.object(nginx.shutil, "which", return_value="/usr/bin/docker"), patch.object(
            nginx, "_docker_container_inspect", return_value=inspect
        ):
            with self.assertRaisesRegex(InstallerError, "bind mount"):
                nginx.DockerNginxManager.discover("nginx")

    def test_docker_config_path_is_derived_from_conf_d_or_nginx_root_bind_mount(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            direct = root / "direct"
            direct.mkdir()
            direct_inspect = self.docker_inspect(
                mounts=[{"Type": "bind", "Source": str(direct), "Destination": "/etc/nginx/conf.d"}]
            )
            with patch.object(nginx.shutil, "which", return_value="/usr/bin/docker"), patch.object(
                nginx, "_docker_container_inspect", return_value=direct_inspect
            ), patch.object(nginx.DockerNginxManager, "validate_syntax"):
                direct_manager = nginx.DockerNginxManager.discover("nginx")
            self.assertEqual(direct_manager.config_path, direct.resolve() / "slothvault.conf")

            full = root / "full"
            (full / "conf.d").mkdir(parents=True)
            full_inspect = self.docker_inspect(
                mounts=[{"Type": "bind", "Source": str(full), "Destination": "/etc/nginx"}]
            )
            with patch.object(nginx.shutil, "which", return_value="/usr/bin/docker"), patch.object(
                nginx, "_docker_container_inspect", return_value=full_inspect
            ), patch.object(nginx.DockerNginxManager, "validate_syntax"):
                full_manager = nginx.DockerNginxManager.discover("nginx")
            self.assertEqual(full_manager.config_path, full.resolve() / "conf.d" / "slothvault.conf")

    def test_docker_config_target_refuses_symlink_escape(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_directory = root / "conf"
            outside = root / "outside.conf"
            config_directory.mkdir()
            (config_directory / "slothvault.conf").symlink_to(outside)
            inspect = self.docker_inspect(
                mounts=[{"Type": "bind", "Source": str(config_directory), "Destination": "/etc/nginx/conf.d"}]
            )
            with patch.object(nginx.shutil, "which", return_value="/usr/bin/docker"), patch.object(
                nginx, "_docker_container_inspect", return_value=inspect
            ):
                with self.assertRaisesRegex(InstallerError, "普通文件"):
                    nginx.DockerNginxManager.discover("nginx")

    def test_docker_config_target_must_be_writable_before_any_file_is_created(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config_directory = Path(directory) / "conf"
            config_directory.mkdir()
            config_directory.chmod(0o555)
            inspect = self.docker_inspect(
                mounts=[{"Type": "bind", "Source": str(config_directory), "Destination": "/etc/nginx/conf.d"}]
            )
            try:
                with patch.object(nginx.shutil, "which", return_value="/usr/bin/docker"), patch.object(
                    nginx, "_docker_container_inspect", return_value=inspect
                ):
                    with self.assertRaisesRegex(InstallerError, "不可写"):
                        nginx.DockerNginxManager.discover("nginx")
            finally:
                config_directory.chmod(0o755)

    def docker_manager(self, config_path: Path) -> nginx.DockerNginxManager:
        return nginx.DockerNginxManager(
            "/usr/bin/docker",
            "nginx",
            self.docker_inspect(),
            config_path,
            nginx.DockerMount(config_path.parent, Path("/etc/nginx/conf.d")),
        )

    def test_docker_apply_uses_only_container_nginx_commands_and_slothvault_upstream(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "slothvault.conf"
            manager = self.docker_manager(config_path)
            proxy = manager.proxy_config(("vault.example.com",))
            calls = []

            def command_output(command, context="Nginx 配置检查"):
                calls.append(tuple(command))
                if command[-1] == "-T":
                    return "http {0}".format(nginx.MANAGED_NGINX_MARKER)
                return "ok"

            with patch.object(nginx, "nginx_command_output", side_effect=command_output), patch.object(
                nginx.shutil, "which", return_value="/usr/bin/systemctl"
            ) as systemctl:
                nginx.apply_nginx_site(proxy, nginx.render_http_proxy_config(proxy))

            source = config_path.read_text(encoding="utf-8")
            self.assertIn("proxy_pass http://slothvault:3000;", source)
            self.assertNotIn("127.0.0.1", source)
            self.assertEqual(
                calls,
                [
                    ("/usr/bin/docker", "exec", "nginx", "nginx", "-t"),
                    ("/usr/bin/docker", "exec", "nginx", "nginx", "-T"),
                    ("/usr/bin/docker", "exec", "nginx", "nginx", "-s", "reload"),
                ],
            )
            systemctl.assert_not_called()

    def test_docker_validation_and_reload_failure_restore_prior_configuration(self) -> None:
        for failure in ("-T", "reload"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                config_path = Path(directory) / "slothvault.conf"
                original = "{0}\n# previous\n".format(nginx.MANAGED_NGINX_MARKER)
                config_path.write_text(original, encoding="utf-8")
                manager = self.docker_manager(config_path)
                proxy = manager.proxy_config(("vault.example.com",))
                calls = []

                def command_output(command, context="Nginx 配置检查"):
                    calls.append(tuple(command))
                    if failure == "-T" and command[-1] == "-T":
                        raise InstallerError("Docker Nginx 最终配置检查失败")
                    if failure == "reload" and command[-2:] == ("-s", "reload") and calls.count(tuple(command)) == 1:
                        raise InstallerError("Docker Nginx 重载失败")
                    if command[-1] == "-T":
                        return nginx.MANAGED_NGINX_MARKER
                    return "ok"

                with patch.object(nginx, "nginx_command_output", side_effect=command_output):
                    with self.assertRaises(InstallerError):
                        nginx.apply_nginx_site(proxy, nginx.render_http_proxy_config(proxy))

                self.assertEqual(config_path.read_text(encoding="utf-8"), original)
                self.assertGreaterEqual(calls.count(("/usr/bin/docker", "exec", "nginx", "nginx", "-t")), 2)
                self.assertGreaterEqual(calls.count(("/usr/bin/docker", "exec", "nginx", "nginx", "-s", "reload")), 1)

    def test_docker_upstream_requires_shared_network_and_slothvault_alias(self) -> None:
        manager = nginx.DockerNginxManager(
            "/usr/bin/docker",
            "nginx",
            self.docker_inspect(networks={"slothvault_default": {}}),
            Path("/tmp/slothvault.conf"),
            nginx.DockerMount(Path("/tmp"), Path("/etc/nginx/conf.d")),
        )
        manager.ensure_shared_slothvault_network(
            {"NetworkSettings": {"Networks": {"slothvault_default": {"Aliases": ["slothvault"]}}}}
        )
        with self.assertRaisesRegex(InstallerError, "没有共享"):
            manager.ensure_shared_slothvault_network(
                {"NetworkSettings": {"Networks": {"other_default": {"Aliases": ["slothvault"]}}}}
            )
        with self.assertRaisesRegex(InstallerError, "slothvault 别名"):
            manager.ensure_shared_slothvault_network(
                {"NetworkSettings": {"Networks": {"slothvault_default": {"Aliases": ["different"]}}}}
            )

    def test_docker_https_requires_acme_and_certificate_bind_mounts(self) -> None:
        manager = self.docker_manager(Path("/tmp/slothvault.conf"))
        with tempfile.TemporaryDirectory() as directory:
            acme = Path(directory) / "acme-challenge"
            acme.mkdir()
            with self.assertRaisesRegex(InstallerError, "ACME Webroot"):
                manager.https_container_paths(acme)

    def test_docker_https_renders_container_acme_and_certificate_paths(self) -> None:
        manager = self.docker_manager(Path("/tmp/slothvault.conf"))
        proxy = manager.proxy_config(
            ("vault.example.com",), certificate_root=Path("/container/letsencrypt")
        )
        source = nginx.render_https_proxy_config(proxy, Path("/container/acme"))
        self.assertIn("root /container/acme;", source)
        self.assertIn("/container/letsencrypt/live/vault.example.com/fullchain.pem", source)
        self.assertNotIn("/etc/letsencrypt/live/vault.example.com/fullchain.pem", source)


class CliNginxModeTests(unittest.TestCase):
    def test_nginx_container_selects_docker_without_auto_scanning(self) -> None:
        arguments = cli.parse_arguments(("--action", "nginx", "--nginx-container", "edge-nginx"))
        self.assertEqual(cli.resolved_nginx_mode(arguments), "docker")

    def test_system_mode_and_container_are_rejected_as_ambiguous(self) -> None:
        arguments = cli.parse_arguments(
            ("--action", "nginx", "--nginx-mode", "system", "--nginx-container", "edge-nginx")
        )
        with self.assertRaisesRegex(InstallerError, "不能与"):
            cli.resolved_nginx_mode(arguments)


class DockerCertbotHookTests(unittest.TestCase):
    def test_docker_renewal_hook_reloads_only_the_selected_container(self) -> None:
        manager = nginx.DockerNginxManager(
            "/usr/bin/docker",
            "edge-nginx",
            {"Mounts": []},
            Path("/tmp/slothvault.conf"),
            nginx.DockerMount(Path("/tmp"), Path("/etc/nginx/conf.d")),
        )
        source = certbot.renewal_hook_source(manager)
        self.assertIn("/usr/bin/docker exec edge-nginx nginx -s reload", source)
        self.assertNotIn("systemctl", source)


class CertbotTests(unittest.TestCase):
    def test_certificate_domains_reject_wildcards_and_ip_addresses(self) -> None:
        self.assertEqual(
            certbot.validate_certificate_domains(("vault.example.com", "www.vault.example.com")),
            ("vault.example.com", "www.vault.example.com"),
        )
        with self.assertRaises(InstallerError):
            certbot.validate_certificate_domains(("*.example.com",))
        with self.assertRaises(InstallerError):
            certbot.validate_certificate_domains(("192.0.2.1",))

    def test_debian_certbot_install_uses_apt_without_other_installers(self) -> None:
        with patch.object(certbot, "certbot_executable", side_effect=[None, "/usr/bin/certbot"]), patch.object(
            certbot, "read_os_release", return_value={"ID": "ubuntu", "ID_LIKE": "debian"}
        ), patch.object(certbot, "require_root"), patch.object(
            certbot.shutil, "which", return_value="/usr/bin/apt-get"
        ), patch.object(certbot, "run_command") as run_command:
            executable = certbot.ensure_certbot()

        self.assertEqual(executable, "/usr/bin/certbot")
        self.assertEqual(
            [call[0][0] for call in run_command.call_args_list],
            [("/usr/bin/apt-get", "update"), ("/usr/bin/apt-get", "install", "-y", "certbot")],
        )

    def test_unsupported_distribution_refuses_automatic_certbot_install(self) -> None:
        with patch.object(certbot, "certbot_executable", return_value=None), patch.object(
            certbot, "read_os_release", return_value={"ID": "arch"}
        ), patch.object(certbot, "require_root"):
            with self.assertRaisesRegex(InstallerError, "仅自动安装"):
                certbot.ensure_certbot()

    def test_fedora_certbot_install_uses_dnf(self) -> None:
        with patch.object(certbot, "certbot_executable", side_effect=[None, "/usr/bin/certbot"]), patch.object(
            certbot, "read_os_release", return_value={"ID": "fedora", "ID_LIKE": "fedora"}
        ), patch.object(certbot, "require_root"), patch.object(
            certbot.shutil, "which", return_value="/usr/bin/dnf"
        ), patch.object(certbot, "run_command") as run_command:
            executable = certbot.ensure_certbot()

        self.assertEqual(executable, "/usr/bin/certbot")
        self.assertEqual([call[0][0] for call in run_command.call_args_list], [("/usr/bin/dnf", "install", "-y", "certbot")])

    def test_active_certbot_timer_is_reused(self) -> None:
        systemd_runtime = unittest.mock.Mock()
        systemd_runtime.exists.return_value = True
        with patch.object(certbot.shutil, "which", return_value="/usr/bin/systemctl"), patch.object(
            certbot, "Path", return_value=systemd_runtime
        ), patch.object(certbot, "command_succeeds", side_effect=[True, True]):
            self.assertEqual(certbot.existing_certbot_timer(), "certbot.timer")

    def test_cron_fallback_is_generated_when_systemd_is_unavailable(self) -> None:
        with patch.object(certbot, "require_root"), patch.object(
            certbot, "existing_certbot_timer", return_value=None
        ), patch.object(certbot.shutil, "which", return_value=None), patch.object(
            certbot, "write_managed_host_file"
        ) as write_file:
            result = certbot.configure_automatic_renewal("/usr/bin/certbot")

        self.assertIn("/etc/cron.d/slothvault-certbot-renew", result)
        self.assertEqual(
            [call[0][0] for call in write_file.call_args_list],
            [certbot.CRON_WRAPPER_PATH, certbot.CRON_RENEWAL_PATH],
        )

    def test_dry_run_renewal_runs_deploy_hooks(self) -> None:
        with patch.object(certbot, "run_command") as run_command:
            certbot.renew_certificate("/usr/bin/certbot", dry_run=True)

        self.assertEqual(
            run_command.call_args[0][0],
            ("/usr/bin/certbot", "renew", "--quiet", "--dry-run", "--run-deploy-hooks"),
        )

    def test_renewal_sources_include_systemd_timer_and_cron_random_delay(self) -> None:
        self.assertIn("RandomizedDelaySec=3600", certbot.managed_systemd_timer_source())
        self.assertIn("renew --quiet", certbot.managed_systemd_service_source("/usr/bin/certbot"))
        self.assertIn("/dev/urandom", certbot.managed_cron_wrapper_source("/usr/bin/certbot"))
        self.assertIn("slothvault-certbot-renew", certbot.managed_cron_source())


if __name__ == "__main__":
    unittest.main()
