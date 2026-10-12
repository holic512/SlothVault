"""
@file nginx_discovery.py
@project SlothVault
@module Nginx instance and site discovery
@description Finds running host and Docker Nginx configurations and maps sites to persistent files.
@logic Inspect execution context, load source-labelled configuration, map bind mounts, and match application endpoints without image-name admission rules.
@dependencies Python standard library, Nginx CLI, Docker CLI, nginx_config
@index_tags nginx,discovery,docker,system,sites,status
@author holic512
"""
from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

from .nginx import DockerMount, DockerNginxManager, SystemNginxManager
from .nginx_config import Configuration, Directive, loaded_sources, transfer_status
from .system import InstallerError, path_is_within


def output(command: tuple[str, ...], *, optional: bool = False) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=15)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise InstallerError('Nginx 检查命令不可用或超时：' + command[0]) from error
    if result.returncode and not optional:
        # Full nginx -T errors may contain private configuration; expose an operation code only.
        raise InstallerError('Nginx 检查失败：' + (' '.join(command[-2:]) if command[-1] in ('-t', '-T', '-V') else command[0]))
    return result


def context_arguments(words: list[str]) -> tuple[str, ...]:
    result = []
    for index, word in enumerate(words):
        if word in ('-c', '-p') and index + 1 < len(words):
            result.extend((word, words[index + 1]))
        elif word.startswith(('-c', '-p')) and len(word) > 2:
            result.extend((word[:2], word[2:]))
    return tuple(result)


def compile_paths(version: str, arguments: tuple[str, ...]) -> tuple[str, str]:
    flags = shlex.split(version.replace('\n', ' '))
    defaults = {flag.split('=', 1)[0]: flag.split('=', 1)[1] for flag in flags if '=' in flag}
    args = dict(zip(arguments[::2], arguments[1::2]))
    prefix = args.get('-p', defaults.get('--prefix', '/usr/local/nginx'))
    main = args.get('-c', defaults.get('--conf-path', '/etc/nginx/nginx.conf'))
    if not main.startswith('/'):
        main = str(PurePosixPath(prefix) / main)
    return main, prefix


@dataclass
class Instance:
    manager: SystemNginxManager | DockerNginxManager
    running: bool
    main: str = ''
    prefix: str = ''
    version: str = ''
    config: Configuration | None = None
    error: str | None = None
    mounts: list[dict[str, str]] = field(default_factory=list)

    @property
    def identity(self) -> str:
        return self.manager.mode + ':' + (getattr(self.manager, 'container_name', None) or self.main)

    def host_path(self, container_path: str) -> tuple[Path, bool] | None:
        if self.manager.mode == 'system':
            path = Path(container_path)
            if path.is_file():
                return path.resolve(strict=True), False
            return None
        candidates = []
        for mount in self.mounts:
            destination = PurePosixPath(mount['destination'])
            path = PurePosixPath(container_path)
            try:
                relative = path.relative_to(destination)
            except ValueError:
                continue
            source = Path(mount['source'])
            if source.is_file() and str(relative) == '.':
                candidates.append((len(str(destination)), source.resolve(strict=True), True))
            elif source.is_dir():
                target = source.joinpath(*relative.parts)
                if target.is_file() and path_is_within(target.resolve(strict=True), source.resolve(strict=True)):
                    candidates.append((len(str(destination)), target.resolve(strict=True), False))
        if not candidates:
            return None
        _, path, single_file = max(candidates, key=lambda item: item[0])
        return path, single_file

    def load(self) -> None:
        if not self.running:
            self.error = 'NOT_RUNNING'
            return
        try:
            output(self.manager.command('-t'))
            dump = output(self.manager.command('-T')).stdout
            sources = loaded_sources(dump)
            if self.main not in sources:
                raise InstallerError('主配置未出现在 nginx -T 来源中')
            # Use actual text for editable files; -T adds separators around each source.
            for origin, source in list(sources.items()):
                mapped = self.host_path(origin)
                if mapped:
                    actual = mapped[0].read_text(encoding='utf-8')
                    if actual.strip() != source.strip():
                        raise InstallerError('配置在读取期间发生变化，请重新检测')
                    sources[origin] = actual
            self.config = Configuration(sources, self.main, self.prefix)
        except (InstallerError, OSError, ValueError):
            self.error = 'CONFIG_CHECK_FAILED'

    def summary(self) -> dict[str, Any]:
        return {'id': self.identity, 'mode': self.manager.mode, 'container': getattr(self.manager, 'container_name', None),
                'running': self.running, 'mainConfig': self.main, 'version': self.version,
                'syntax': 'passed' if self.config else 'unknown' if not self.running else 'failed',
                'mounts': self.mounts, 'error': self.error}


@dataclass
class Site:
    instance: Instance
    origin: str
    node: Directive
    inherited: dict[str, str]
    matched: bool

    @property
    def names(self) -> list[str]:
        config = self.instance.config
        return config.values(self.node.children, self.origin).get('server_name', '').split() if config else []

    def summary(self) -> dict[str, Any]:
        config = self.instance.config
        assert config is not None
        values = config.values(self.node.children, self.origin)
        mapped = self.instance.host_path(self.origin)
        return {'instanceId': self.instance.identity, 'mode': self.instance.manager.mode,
                'container': getattr(self.instance.manager, 'container_name', None), 'siteConfig': self.origin,
                'hostConfig': str(mapped[0]) if mapped else None, 'singleFileMount': mapped[1] if mapped else False,
                'serverNames': self.names, 'serverName': next(iter(self.names), None), 'matched': self.matched,
                'line': config.sources[self.origin][:self.node.start].count('\n') + 1,
                'https': 'ssl_certificate' in values, 'certificate': values.get('ssl_certificate'),
                'listen': [entry.words[1:] for _, entry in config.expanded(self.node.children, self.origin) if entry.words[0] == 'listen'],
                'upstreams': config.proxy_targets(self.node, self.origin), 'loaded': True,
                'writable': bool(mapped and os.access(mapped[0], os.W_OK)),
                'transfer': transfer_status(config, self.origin, self.node, self.inherited)}


def host_instances(main_override: str | None = None) -> list[Instance]:
    contexts: list[tuple[str, tuple[str, ...], bool]] = []
    try:
        processes = output(('ps', '-eo', 'pid=,args='), optional=True).stdout
        for line in processes.splitlines():
            if not re.match(r'^\s*\d+\s+nginx: master process ', line):
                continue
            pid, command = line.strip().split(None, 1)
            words = shlex.split(command.split('nginx: master process ', 1)[1])
            if not words:
                continue
            executable = words[0]
            proc_exe = Path('/proc') / pid / 'exe'
            if proc_exe.exists():
                executable = str(proc_exe.resolve())
            contexts.append((executable, context_arguments(words[1:]), True))
    except (InstallerError, OSError, ValueError):
        pass
    # systemd is also useful when process titles or PATH do not expose the executable.
    if not contexts and shutil.which('systemctl'):
        try:
            service = output(('systemctl', 'show', 'nginx', '-p', 'MainPID', '-p', 'ExecStart'), optional=True).stdout
            executable = re.search(r'path=([^ ;}]+)', service)
            argv = re.search(r'argv\[\]=([^}]+?)(?: ;|})', service)
            pid = re.search(r'^MainPID=(\d+)', service, re.MULTILINE)
            if executable:
                contexts.append((executable[1], context_arguments(shlex.split(argv[1])) if argv else (), bool(pid and pid[1] != '0')))
        except (InstallerError, OSError, ValueError):
            pass
    if not contexts and shutil.which('nginx'):
        contexts.append((shutil.which('nginx') or 'nginx', (), False))
    result, seen = [], set()
    for executable, arguments, running in contexts:
        if main_override:
            arguments = tuple(item for pair in zip(arguments[::2], arguments[1::2]) if pair[0] != '-c' for item in pair) + ('-c', main_override)
        try:
            version = output((executable, '-V'))
            description = version.stdout + version.stderr
            main, prefix = compile_paths(description, arguments)
            if (executable, main, prefix) in seen:
                continue
            seen.add((executable, main, prefix))
            manager = SystemNginxManager(executable, Path(main), None)
            manager.arguments = arguments
            instance = Instance(manager, running, main, prefix, description.splitlines()[0])
            # Even a stopped host installation can validate config; do not claim it is running.
            instance.running = True
            instance.load()
            instance.running = running
            result.append(instance)
        except (InstallerError, OSError, ValueError):
            continue
    return result


def docker_instances(container: str | None = None, main_override: str | None = None) -> list[Instance]:
    docker = shutil.which('docker')
    if not docker:
        return []
    try:
        ids = [container] if container else output((docker, 'ps', '-a', '--format', '{{.ID}}')).stdout.split()
        if not ids:
            return []
        records = json.loads(output((docker, 'inspect', '--type', 'container', *ids)).stdout)
    except (InstallerError, ValueError):
        return []
    result = []
    for record in records:
        name = str(record.get('Name', '')).lstrip('/')
        state = record.get('State') or {}
        mounts = [{'source': entry['Source'], 'destination': entry['Destination']} for entry in record.get('Mounts', [])
                  if entry.get('Type') == 'bind' and isinstance(entry.get('Source'), str) and isinstance(entry.get('Destination'), str)]
        manager = DockerNginxManager(docker, name, record, Path('/etc/nginx/nginx.conf'), DockerMount(Path('/'), Path('/')))
        instance = Instance(manager, state.get('Running') is True, mounts=mounts)
        if not instance.running:
            if container or any('nginx' in entry['destination'] for entry in mounts) or 'nginx' in str((record.get('Config') or {}).get('Image', '')).lower():
                instance.main, instance.error = main_override or '/etc/nginx/nginx.conf', 'NOT_RUNNING'
                result.append(instance)
            continue
        try:
            version = output(manager.command('-V'))
            description = version.stdout + version.stderr
            if 'nginx version:' not in description:
                continue
            # Official images normally have Nginx as PID 1. Honor its -c/-p context.
            cmdline = output((docker, 'exec', name, 'cat', '/proc/1/cmdline'), optional=True).stdout
            if 'nginx: master process ' in cmdline:
                words = shlex.split(cmdline.replace('\x00', ' ').split('nginx: master process ', 1)[1])
            else:
                words = cmdline.rstrip('\x00').split('\x00')
            arguments = context_arguments(words)
            if main_override:
                arguments = tuple(item for pair in zip(arguments[::2], arguments[1::2]) if pair[0] != '-c' for item in pair) + ('-c', main_override)
            manager.arguments = arguments
            instance.main, instance.prefix = compile_paths(description, arguments)
            instance.version = description.splitlines()[0]
            instance.load()
            if not mounts and instance.config:
                instance.error = 'NO_BIND_MOUNT'
            result.append(instance)
        except (InstallerError, ValueError):
            if container:
                instance.error = 'NGINX_UNAVAILABLE'
                result.append(instance)
    return result


def application_endpoints(port: int, inspect: dict[str, Any] | None = None) -> set[str]:
    endpoints = {f'127.0.0.1:{port}', f'localhost:{port}', f'[::1]:{port}'}
    for network in ((inspect or {}).get('NetworkSettings') or {}).get('Networks', {}).values():
        for alias in network.get('Aliases') or []:
            endpoints.add(str(alias) + ':3000')
        if network.get('IPAddress'):
            endpoints.add(network['IPAddress'] + ':3000')
    return endpoints


def discover(mode: str, container: str | None, main: str | None, endpoints: set[str]) -> tuple[list[Instance], list[Site]]:
    instances = []
    if mode != 'docker' and not container:
        instances.extend(host_instances(main))
    if mode != 'system':
        instances.extend(docker_instances(container, main))
    sites = []
    for instance in instances:
        if not instance.config:
            continue
        for origin, node, inherited in instance.config.servers():
            targets = instance.config.proxy_targets(node, origin)
            matched = any(target in endpoints for target in targets)
            sites.append(Site(instance, origin, node, inherited, matched))
    # Link HTTP redirect blocks to the matched HTTPS site by domain within the same instance.
    names = {(site.instance.identity, name) for site in sites if site.matched for name in site.names}
    for site in sites:
        values = site.instance.config.values(site.node.children, site.origin) if site.instance.config else {}
        if not site.matched and any((site.instance.identity, name) in names for name in site.names):
            if 'ssl_certificate' not in values and not site.instance.config.proxy_targets(site.node, site.origin):
                site.matched = True
    return instances, sites
