"""
@file nginx_management.py
@project SlothVault
@module Site-scoped Nginx operations
@description Provides discovery, status and recoverable updates for one selected SlothVault site.
@logic Resolve real loaded sources, review a minimal directive diff, lock and back up changed files, validate and reload the original instance, and persist only verified target metadata.
@dependencies Python standard library, compose inspection, nginx discovery and configuration services
@index_tags nginx,site,update,backup,rollback,bridge
@author holic512
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from pathlib import PurePosixPath
from types import SimpleNamespace
from uuid import uuid4

from .compose import COMPOSE_FILE_NAME, inspect_managed_application, read_published_application_port, require_managed_compose
from .nginx_config import Configuration, loaded_sources, patch_server
from .nginx_discovery import Instance, Site, application_endpoints, discover, output
from .nginx import NginxProxyConfig, apply_nginx_site, render_http_proxy_config, validate_server_name
from .system import InstallerError, print_info, prompt_confirm, prompt_value, publish_event, require_root, validate_port, write_text_atomically

TARGET_FILE = '.nginx-target.json'


def saved_target(root: Path) -> dict[str, str]:
    try:
        path = root / TARGET_FILE
        if path.is_symlink() or path.stat().st_size > 16384:
            return {}
        value = json.loads(path.read_text(encoding='utf-8'))
        keys = {'mode', 'container', 'mainConfig', 'siteConfig', 'serverName'}
        return {key: item for key, item in value.items() if key in keys and isinstance(item, str)}
    except (OSError, ValueError, AttributeError):
        return {}


def arguments_for_target(root: Path):
    target = saved_target(root)
    return SimpleNamespace(nginx_mode=target.get('mode', 'auto'), nginx_container=target.get('container'),
                           nginx_config=target.get('mainConfig'), nginx_site=target.get('siteConfig'),
                           nginx_server_name=target.get('serverName'))


def inspect_targets(root: Path, arguments=None) -> tuple[list[Instance], list[Site]]:
    arguments = arguments or arguments_for_target(root)
    if getattr(arguments, 'action', '') != 'nginx-discover' and arguments.nginx_mode == 'auto' and not any(
        getattr(arguments, key, None) for key in ('nginx_container', 'nginx_config', 'nginx_site', 'nginx_server_name')
    ) and saved_target(root):
        arguments = arguments_for_target(root)
    compose_path = root / COMPOSE_FILE_NAME
    require_managed_compose(compose_path)
    _, port, _ = read_published_application_port(compose_path)
    try:
        application = inspect_managed_application(compose_path)
    except (InstallerError, OSError):
        application = None
    mode = arguments.nginx_mode
    container = getattr(arguments, 'nginx_container', None)
    if container:
        if mode == 'system':
            raise InstallerError('系统级 Nginx 不能同时指定 Docker 容器')
        mode = 'docker'
    instances, sites = discover(mode, container, getattr(arguments, 'nginx_config', None), application_endpoints(port, application))
    site_path = getattr(arguments, 'nginx_site', None)
    name = getattr(arguments, 'nginx_server_name', None)
    if site_path:
        sites = [site for site in sites if site.origin == site_path or (site.instance.host_path(site.origin) and str(site.instance.host_path(site.origin)[0]) == site_path)]
    if name:
        sites = [site for site in sites if name in site.names]
    return instances, sites


def site_candidates(sites: list[Site]) -> list[Site]:
    proxy_sites = [site for site in sites if site.instance.config and site.instance.config.proxy_targets(site.node, site.origin)]
    matches = [site for site in proxy_sites if site.matched]
    return matches or proxy_sites


def select_site(sites: list[Site]) -> Site:
    candidates = site_candidates(sites)
    if not candidates:
        raise InstallerError('未找到可用的 SlothVault 代理站点；请检查服务、挂载与生效配置，或先配置基础反向代理')
    if len(candidates) == 1 and candidates[0].matched:
        return candidates[0]
    print_info('请选择 SlothVault 对应的站点（仅修改选定站点）：')
    for index, site in enumerate(candidates, 1):
        print_info(f'{index}) {site.instance.identity} | {site.origin} | {", ".join(site.names)} | ' + ', '.join(site.summary()['upstreams']))
    while True:
        try:
            answer = input('站点编号（留空取消）：').strip()
        except EOFError as error:
            raise InstallerError('未选定站点，未修改配置') from error
        if not answer:
            raise KeyboardInterrupt()
        if answer.isdigit() and 1 <= int(answer) <= len(candidates):
            return candidates[int(answer) - 1]


def nginx_snapshot(root: Path, arguments=None) -> dict[str, object]:
    try:
        instances, sites = inspect_targets(root, arguments)
        candidates = site_candidates(sites)
        selected = candidates[0] if len(candidates) == 1 and (candidates[0].matched or saved_target(root)) else None
        result = {'state': 'configured' if selected else 'selection-required' if sites else 'unavailable',
                  'instances': [instance.summary() for instance in instances], 'sites': [site.summary() for site in sites],
                  'serverName': None, 'https': False, 'certificate': 'unknown'}
        if selected:
            summary = selected.summary()
            result.update(summary)
            result.update(running=selected.instance.running, mainConfig=selected.instance.main,
                          syntax='passed', version=selected.instance.version)
        return result
    except (InstallerError, OSError, ValueError):
        return {'state': 'unreadable', 'serverName': None, 'https': False, 'certificate': 'unknown',
                'instances': [], 'sites': [], 'error': 'DISCOVERY_FAILED'}


def show_nginx(arguments, root: Path) -> None:
    snapshot = nginx_snapshot(root, arguments)
    publish_event('preview', {'kind': arguments.action, 'nginxStatus': snapshot})
    print(json.dumps(snapshot, ensure_ascii=False, indent=2))


def persist_target(root: Path, site: Site) -> None:
    value = {'mode': site.instance.manager.mode, 'mainConfig': site.instance.main,
             'siteConfig': site.origin, 'serverName': site.names[0] if site.names else ''}
    if site.instance.manager.mode == 'docker':
        value['container'] = site.instance.manager.container_name
    if (root / TARGET_FILE).is_symlink():
        raise InstallerError('Nginx 目标元数据不能是符号链接')
    write_text_atomically(root / TARGET_FILE, json.dumps(value, ensure_ascii=False, indent=2) + '\n', 0o600)


def write_site(path: Path, source: str, info: os.stat_result, single_file: bool) -> None:
    """Directory binds permit rename; file binds require the original inode."""
    if single_file:
        with path.open('r+', encoding='utf-8') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            actual = os.fstat(handle.fileno())
            if (actual.st_dev, actual.st_ino) != (info.st_dev, info.st_ino):
                raise InstallerError('单文件挂载的 inode 已变化，请重新检测')
            handle.seek(0)
            handle.write(source)
            handle.truncate()
            handle.flush()
            os.fsync(handle.fileno())
        return
    descriptor, name = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            os.fchmod(handle.fileno(), info.st_mode & 0o7777)
            if (os.fstat(handle.fileno()).st_uid, os.fstat(handle.fileno()).st_gid) != (info.st_uid, info.st_gid):
                os.fchown(handle.fileno(), info.st_uid, info.st_gid)
            handle.write(source)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def apply_updates(root: Path, instance: Instance, updates: dict[str, str]) -> Path | None:
    assert instance.config is not None
    originals, paths, stats = {}, {}, {}
    for origin, source in updates.items():
        mapped = instance.host_path(origin)
        if not mapped:
            raise InstallerError('生效配置没有可写的宿主机 bind mount：' + origin)
        path, single_file = mapped
        if path in (item[0] for item in paths.values()):
            raise InstallerError('多个配置来源映射到同一文件，拒绝写入')
        actual = path.read_text(encoding='utf-8')
        if actual != instance.config.sources[origin]:
            raise InstallerError('配置在预览后已变化，请重新检测')
        if source != actual:
            originals[origin], paths[origin], stats[origin] = actual, mapped, path.stat()
    if not originals:
        return None
    lock_path = root / '.nginx-update.lock'
    if lock_path.is_symlink():
        raise InstallerError('Nginx 操作锁不能是符号链接')
    with lock_path.open('a', encoding='utf-8') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        # Re-read all mapped loaded sources, including shared includes, before mutation.
        for origin, original in instance.config.sources.items():
            mapped = instance.host_path(origin)
            if mapped and mapped[0].read_text(encoding='utf-8') != original:
                raise InstallerError('配置依赖在预览后发生变化，请重新检测')
        backup_root = root / '.nginx-backups'
        if backup_root.is_symlink():
            raise InstallerError('Nginx 备份目录不能是符号链接')
        backup_root.mkdir(mode=0o700, exist_ok=True)
        backup = backup_root / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid4().hex)
        backup.mkdir(mode=0o700)
        manifest = []
        for index, (origin, original) in enumerate(originals.items()):
            saved = backup / f'{index}.conf'
            saved.write_text(original, encoding='utf-8')
            saved.chmod(0o600)
            info = stats[origin]
            manifest.append({'source': str(paths[origin][0]), 'backup': saved.name, 'mode': info.st_mode & 0o7777,
                             'uid': info.st_uid, 'gid': info.st_gid, 'sha256': hashlib.sha256(original.encode()).hexdigest()})
        write_text_atomically(backup / 'manifest.json', json.dumps(manifest, indent=2) + '\n', 0o600)
        written = []
        try:
            for origin, (path, single_file) in paths.items():
                # Record before writing so a partially failed in-place write is rolled back.
                written.append(origin)
                write_site(path, updates[origin], stats[origin], single_file)
            output(instance.manager.command('-t'))
            loaded = loaded_sources(output(instance.manager.command('-T')).stdout)
            for origin in originals:
                if origin not in loaded or loaded[origin].strip() != updates[origin].strip():
                    raise InstallerError('更新后的目标配置未被 Nginx 加载：' + origin)
            output(instance.manager.command('-s', 'reload'))
        except (InstallerError, OSError, KeyboardInterrupt) as error:
            failures = []
            for origin in reversed(written):
                try:
                    path, single_file = paths[origin]
                    write_site(path, originals[origin], stats[origin], single_file)
                except (InstallerError, OSError):
                    failures.append(str(paths[origin][0]))
            try:
                output(instance.manager.command('-t'))
                output(instance.manager.command('-s', 'reload'))
            except InstallerError:
                failures.append('原实例校验或重载')
            if failures:
                raise InstallerError('更新失败，且回滚未完成：' + ', '.join(failures) + '；备份：' + str(backup)) from error
            if isinstance(error, KeyboardInterrupt):
                print_info('更新已取消，原配置已恢复；备份：' + str(backup))
                raise
            raise InstallerError('更新失败，原配置已恢复；备份：' + str(backup)) from error
        return backup


def update_nginx(arguments, root: Path) -> None:
    require_root('更新 Nginx 站点配置')
    _, sites = inspect_targets(root, arguments)
    selected = select_site(sites)
    instance = selected.instance
    if not instance.running:
        raise InstallerError('Nginx 当前未运行；未修改配置')
    config = instance.config
    assert config is not None
    # A selected server is the boundary, even when several domains share its source file.
    source, changes = patch_server(config, selected.origin, selected.node, selected.inherited)
    if source == config.sources[selected.origin]:
        print_info('选定站点已满足传输要求，无需修改或重载')
        persist_target(root, selected)
        return
    summary = selected.summary()
    if not summary['writable']:
        raise InstallerError('选定站点没有可写的宿主机配置文件')
    publish_event('preview', {'kind': 'nginx-update', 'site': ', '.join(selected.names),
                             'mode': instance.manager.mode, 'mainConfig': instance.main,
                             'siteConfig': selected.origin, 'hostConfig': summary['hostConfig'], 'changes': changes})
    print_info('更新目标：' + ', '.join(selected.names) + ' | ' + str(summary['hostConfig']))
    for change in changes:
        print_info(f"{change['policy']}: {change['directive']} {change['value']};")
    prompt_confirm('确认备份并仅更新上述站点配置')
    backup = apply_updates(root, instance, {selected.origin: source})
    persist_target(root, selected)
    print_info('Nginx 站点已更新并重载；备份：' + str(backup))


def select_instance(instances: list[Instance]) -> Instance:
    candidates = [instance for instance in instances if instance.config and instance.running]
    if not candidates:
        raise InstallerError('未找到运行中且配置检查成功的 Nginx；请检查服务、容器和配置目录挂载')
    if len(candidates) == 1:
        return candidates[0]
    for index, instance in enumerate(candidates, 1):
        print_info(f'{index}) {instance.identity} | {instance.main}')
    try:
        value = input('Nginx 实例编号（留空取消）：').strip()
    except EOFError as error:
        raise InstallerError('未选定 Nginx 实例') from error
    if not value:
        raise KeyboardInterrupt()
    if not value.isdigit() or not 1 <= int(value) <= len(candidates):
        raise InstallerError('Nginx 实例编号无效')
    return candidates[int(value) - 1]


def new_site_path(instance: Instance, name: str, root: Path) -> tuple[str, Path]:
    assert instance.config is not None
    config = instance.config
    filename = 'slothvault-' + name + '-' + hashlib.sha256(str(root).encode()).hexdigest()[:8] + '.conf'
    # Only create files in directories already included directly by http.
    patterns = []
    for path, node in config.expanded(config.nodes[config.main], config.main):
        if node.words == ('http',):
            for entry in node.children:
                if entry.words[0] == 'include' and len(entry.words) == 2:
                    patterns.append(entry.words[1])
    candidates = []
    for pattern in patterns:
        if '$' in pattern or PurePosixPath(pattern).name != '*.conf':
            continue
        directory = PurePosixPath(pattern).parent
        if not directory.is_absolute():
            directory = PurePosixPath(config.prefix) / directory
        origin = str(directory / filename)
        if instance.manager.mode == 'system':
            host = Path(origin)
            if host.parent.is_dir():
                candidates.append((origin, host))
        else:
            for mount in instance.mounts:
                try:
                    relative = directory.relative_to(PurePosixPath(mount['destination']))
                except ValueError:
                    continue
                host_directory = Path(mount['source']).joinpath(*relative.parts)
                if host_directory.is_dir() and not host_directory.is_symlink():
                    if host_directory.resolve().is_relative_to(Path(mount['source']).resolve()):
                        candidates.append((origin, host_directory / filename))
    candidates = list(dict.fromkeys(candidates))
    if len(candidates) != 1:
        raise InstallerError('无法唯一确定已加载的独立站点目录；请指定主配置或手工创建站点后运行 nginx-update')
    return candidates[0]


def configure_nginx(arguments, root: Path) -> None:
    instances, sites = inspect_targets(root, arguments)
    if any(site.matched and site.instance.config.proxy_targets(site.node, site.origin) for site in sites):
        # Existing HTTPS, ports, upstreams and custom directives stay intact.
        update_nginx(arguments, root)
        return
    require_root('配置 Nginx 基础反向代理')
    instance = select_instance(instances)
    name = validate_server_name(prompt_value('SlothVault 站点域名或 IPv4 地址', ''))
    port = validate_port(prompt_value('Nginx HTTP 监听端口', '80'))
    origin, host = new_site_path(instance, name, root)
    if host.exists() or host.is_symlink():
        raise InstallerError('目标站点文件已存在，请重新发现并更新现有站点')
    compose_path = root / COMPOSE_FILE_NAME
    _, application_port, _ = read_published_application_port(compose_path)
    manager = instance.manager
    if manager.mode == 'docker':
        manager.ensure_shared_slothvault_network(inspect_managed_application(compose_path))
    manager.config_path = host
    proxy = NginxProxyConfig(executable=manager.docker if manager.mode == 'docker' else manager.executable,
                             config_path=host, enabled_path=None, server_names=(name,), http_port=port,
                             upstream_port=3000 if manager.mode == 'docker' else application_port,
                             upstream_host='slothvault' if manager.mode == 'docker' else '127.0.0.1', manager=manager)
    publish_event('preview', {'kind': 'nginx', 'site': name, 'port': port, 'upstream': proxy.upstream,
                             'mainConfig': instance.main, 'siteConfig': origin, 'hostConfig': str(host)})
    print_info('新建独立站点：' + str(host) + ' → ' + proxy.upstream)
    prompt_confirm('确认新建并启用上述 Nginx 站点')
    apply_nginx_site(proxy, render_http_proxy_config(proxy))
    loaded = loaded_sources(output(manager.command('-T')).stdout)
    if origin not in loaded:
        host.unlink(missing_ok=True)
        output(manager.command('-t'))
        output(manager.command('-s', 'reload'))
        raise InstallerError('新站点未被加载，已移除本轮新建文件')
    instance.config = Configuration({**instance.config.sources, origin: host.read_text(encoding='utf-8')}, instance.main, instance.prefix)
    node = next(node for path, node, _ in instance.config.servers() if path == origin)
    persist_target(root, Site(instance, origin, node, {}, True))
    print_info('独立 Nginx 站点已启用，现有站点和 Compose 保持原样')


def manager_for_action(arguments, root: Path):
    instances, sites = inspect_targets(root, arguments)
    selected = select_site(sites)
    mapped = selected.instance.host_path(selected.origin)
    if not mapped:
        raise InstallerError('站点配置没有对应的宿主机挂载文件')
    manager = selected.instance.manager
    manager.config_path = mapped[0]
    manager.selected_site = selected
    if manager.mode == 'system':
        manager.enabled_path = None
    return manager
