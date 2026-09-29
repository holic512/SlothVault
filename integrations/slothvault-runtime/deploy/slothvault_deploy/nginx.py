"""
@file deploy/slothvault_deploy/nginx.py
@project SlothVault
@module Deployment Nginx management
@description Safely manages one SlothVault Nginx site through either a standard host Nginx installation or an explicitly selected official Docker Nginx container.
@logic Derive every writable site path from a supported system directory or inspected bind mount, render a validated upstream, verify and reload in the selected execution context, and restore the prior managed file on failure.
@dependencies Python standard library, optional host Nginx, optional Docker Engine
@index_tags deployment,installer,nginx,reverse-proxy,docker,https,acme,rollback
@author holic512
"""

from __future__ import annotations

import ipaddress
import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, Sequence

from .system import InstallerError, command_succeeds, path_is_within, prompt_yes_no, run_command, write_text_atomically


MANAGED_NGINX_MARKER = "# Managed by SlothVault deploy installer"
LEGACY_MANAGED_NGINX_MARKER = "# Managed by SlothVault install.py"
MANAGED_NGINX_MARKERS = (MANAGED_NGINX_MARKER, LEGACY_MANAGED_NGINX_MARKER)
CERTIFICATE_NAME_PATTERN = re.compile(r"^# Certificate primary domain: (?P<name>[A-Za-z0-9.-]+)$", re.MULTILINE)
CONTAINER_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
UPSTREAM_HOST_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.-]*$")
UNSUPPORTED_NGINX_PATHS = ("/www/server/nginx", "/www/server/panel/vhost/nginx")
OFFICIAL_NGINX_IMAGES = ("nginx", "library/nginx", "docker.io/library/nginx")


@dataclass(frozen=True)
class NginxProxyConfig:
    """A safely located SlothVault Nginx site and its checked upstream endpoint."""

    executable: str
    config_path: Path
    enabled_path: Optional[Path]
    server_names: tuple[str, ...]
    upstream_port: int
    http_port: int = 80
    upstream_host: str = "127.0.0.1"
    certificate_root: Path = Path("/etc/letsencrypt")
    manager: Optional["NginxManager"] = None

    def __post_init__(self) -> None:
        validate_upstream_host(self.upstream_host)
        if not isinstance(self.upstream_port, int) or not 1 <= self.upstream_port <= 65535:
            raise InstallerError("Nginx 上游端口必须是 1 到 65535 之间的整数")
        if not isinstance(self.http_port, int) or not 1 <= self.http_port <= 65535:
            raise InstallerError("Nginx HTTP 监听端口必须是 1 到 65535 之间的整数")
        if not self.certificate_root.is_absolute():
            raise InstallerError("Nginx 证书根目录必须使用绝对路径")

    @property
    def primary_server_name(self) -> str:
        return self.server_names[0]

    @property
    def upstream(self) -> str:
        return "{0}:{1}".format(self.upstream_host, self.upstream_port)


@dataclass(frozen=True)
class NginxSiteSnapshot:
    """The existing managed site state used for a recoverable write."""

    source: Optional[str]
    mode: int
    enabled_link_existed: bool


@dataclass(frozen=True)
class DockerMount:
    """An inspected Docker bind mount whose host source is safe to use."""

    source: Path
    destination: Path


def validate_server_name(value: str, allow_ip: bool = True) -> str:
    server_name = value.strip().lower().rstrip(".")
    if not server_name or " " in server_name or "\t" in server_name:
        raise InstallerError("Nginx 站点域名必须是单个域名或 IPv4 地址")
    try:
        parsed = ipaddress.ip_address(server_name)
    except ValueError:
        parsed = None
    if parsed is not None:
        if not allow_ip or parsed.version != 4:
            raise InstallerError("Let's Encrypt 证书只支持普通 DNS 域名，不支持 IP 地址")
        return server_name
    if len(server_name) > 253 or "." not in server_name:
        raise InstallerError("域名必须是包含顶级域名的普通 DNS 域名")
    labels = server_name.split(".")
    for label in labels:
        if not label or len(label) > 63:
            raise InstallerError("域名标签长度无效")
        if label[0] == "-" or label[-1] == "-" or not re.fullmatch(r"[a-z0-9-]+", label):
            raise InstallerError("域名只能包含字母、数字、连字符和点")
    return server_name


def validate_container_name(value: str) -> str:
    container_name = value.strip()
    if not CONTAINER_NAME_PATTERN.fullmatch(container_name):
        raise InstallerError("Docker Nginx 容器名只能包含字母、数字、点、下划线和连字符")
    return container_name


def validate_upstream_host(value: str) -> str:
    host = value.strip().lower()
    if not UPSTREAM_HOST_PATTERN.fullmatch(host) or host.startswith(".") or host.endswith("."):
        raise InstallerError("Nginx 上游主机名格式无效")
    return host


def find_nginx() -> Optional[str]:
    return shutil.which("nginx")


def require_nginx() -> str:
    executable = find_nginx()
    if executable is None:
        raise InstallerError("未检测到宿主机 Nginx（或 nginx 不在 PATH 中）；脚本不会自动安装 Nginx。")
    return executable


def nginx_site_paths() -> tuple[Path, Optional[Path]]:
    sites_available = Path("/etc/nginx/sites-available")
    sites_enabled = Path("/etc/nginx/sites-enabled")
    if sites_available.is_dir() and sites_enabled.is_dir():
        return sites_available / "slothvault.conf", sites_enabled / "slothvault.conf"
    conf_directory = Path("/etc/nginx/conf.d")
    if conf_directory.is_dir():
        return conf_directory / "slothvault.conf", None
    raise InstallerError(
        "未找到受支持的 Nginx 站点目录。需要 /etc/nginx/sites-available 与 sites-enabled，或 /etc/nginx/conf.d。"
    )


def nginx_command_output(command: Sequence[str], context: str = "Nginx 配置检查") -> str:
    try:
        result = subprocess.run(list(command), text=True, capture_output=True, check=False)
    except FileNotFoundError as error:
        raise InstallerError("未找到命令：{0}".format(command[0])) from error
    output = "{0}\n{1}".format(result.stdout, result.stderr).strip()
    if result.returncode != 0:
        summary = output[-2000:] if output else "没有输出"
        raise InstallerError("{0}失败：{1}".format(context, summary))
    return output


def _path_contains_unsupported_nginx(value: str) -> bool:
    normalized = value.replace("\\", "/")
    return any(path in normalized for path in UNSUPPORTED_NGINX_PATHS)


def ensure_supported_system_nginx(executable: str) -> None:
    """Reject Baota and panel-managed host Nginx before any standard path is written."""

    resolved = str(Path(executable).resolve(strict=False))
    if _path_contains_unsupported_nginx(resolved):
        raise InstallerError("不支持宝塔或第三方面板托管 Nginx；请使用标准系统级 Nginx。")
    version_output = nginx_command_output((executable, "-V"), "Nginx 安装信息检查")
    if _path_contains_unsupported_nginx(version_output):
        raise InstallerError("不支持宝塔或第三方面板托管 Nginx；脚本不会写入 /www/server 下的配置。")


class NginxManager:
    """Common safe operations shared by system and Docker Nginx implementations."""

    mode = "unknown"

    def validate_site(self, proxy: NginxProxyConfig) -> None:
        raise NotImplementedError

    def reload(self, proxy: NginxProxyConfig, allow_start: bool = True) -> None:
        raise NotImplementedError

    def restore_validation_and_reload(self, proxy: NginxProxyConfig) -> None:
        raise NotImplementedError

    def enable_site(self, proxy: NginxProxyConfig) -> bool:
        return False


class SystemNginxManager(NginxManager):
    """Manage only a standard host Nginx site directory and host service process."""

    mode = "system"

    def __init__(self, executable: str, config_path: Path, enabled_path: Optional[Path]) -> None:
        self.executable = executable
        self.config_path = config_path
        self.enabled_path = enabled_path

    @classmethod
    def discover(cls) -> "SystemNginxManager":
        executable = require_nginx()
        ensure_supported_system_nginx(executable)
        nginx_command_output((executable, "-t"), "系统级 Nginx 预检")
        nginx_command_output((executable, "-T"), "系统级 Nginx 最终配置预检")
        config_path, enabled_path = nginx_site_paths()
        return cls(executable, config_path, enabled_path)

    def proxy_config(
        self, upstream_port: int, server_names: Sequence[str], http_port: int = 80
    ) -> NginxProxyConfig:
        if not server_names:
            raise InstallerError("至少需要一个 Nginx 站点域名")
        return NginxProxyConfig(
            executable=self.executable,
            config_path=self.config_path,
            enabled_path=self.enabled_path,
            server_names=tuple(server_names),
            upstream_port=upstream_port,
            http_port=http_port,
            manager=self,
        )

    def enable_site(self, proxy: NginxProxyConfig) -> bool:
        if proxy.enabled_path is None:
            return False
        enabled_path = proxy.enabled_path
        if os.path.lexists(str(enabled_path)):
            if not enabled_path.is_symlink() or enabled_path.resolve() != proxy.config_path.resolve():
                raise InstallerError("Nginx 启用链接已被其他站点使用：{0}".format(enabled_path))
            return False
        try:
            enabled_path.symlink_to(proxy.config_path)
        except OSError as error:
            raise InstallerError("无法启用 Nginx 站点配置：{0}".format(enabled_path)) from error
        return True

    def validate_site(self, proxy: NginxProxyConfig) -> None:
        nginx_command_output((self.executable, "-t"))
        rendered_configuration = nginx_command_output((self.executable, "-T"))
        if MANAGED_NGINX_MARKER not in rendered_configuration:
            raise InstallerError("Nginx 主配置未包含新站点文件：{0}".format(proxy.config_path))

    def reload(self, proxy: NginxProxyConfig, allow_start: bool = True) -> None:
        systemctl = shutil.which("systemctl")
        if systemctl:
            if command_succeeds((systemctl, "is-active", "--quiet", "nginx")):
                run_command((systemctl, "reload", "nginx"))
                return
            if allow_start and prompt_yes_no("Nginx 服务当前未运行，是否立即启动它"):
                run_command((systemctl, "start", "nginx"))
                return
            raise InstallerError("Nginx 已写入并通过配置检查，但尚未启动；未切换应用端口")
        run_command((self.executable, "-s", "reload"))

    def restore_validation_and_reload(self, proxy: NginxProxyConfig) -> None:
        nginx_command_output((self.executable, "-t"))
        systemctl = shutil.which("systemctl")
        if systemctl and command_succeeds((systemctl, "is-active", "--quiet", "nginx")):
            run_command((systemctl, "reload", "nginx"))
        elif not systemctl:
            run_command((self.executable, "-s", "reload"))


def _docker_command_output(command: Sequence[str], context: str) -> str:
    return nginx_command_output(command, context)


def _docker_container_inspect(docker: str, container_name: str) -> dict[str, Any]:
    try:
        result = subprocess.run(
            (docker, "inspect", "--type", "container", container_name),
            text=True,
            capture_output=True,
            check=False,
        )
    except FileNotFoundError as error:
        raise InstallerError("未找到 Docker 命令；无法管理 Docker Nginx。") from error
    if result.returncode != 0:
        detail = "{0}\n{1}".format(result.stdout, result.stderr).strip()
        raise InstallerError(
            "Docker Nginx 容器不存在或无法检查：{0}{1}".format(
                container_name, "（{0}）".format(detail[-500:]) if detail else ""
            )
        )
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise InstallerError("无法解析 Docker Nginx 容器检查结果；请确认 Docker 服务正常。") from error
    if not isinstance(payload, list) or len(payload) != 1 or not isinstance(payload[0], dict):
        raise InstallerError("Docker Nginx 容器检查结果格式无效；拒绝继续写入配置。")
    return payload[0]


def _official_nginx_image(image: object) -> bool:
    if not isinstance(image, str) or not image:
        return False
    reference = image.lower().split("@", 1)[0]
    image_name = reference.rsplit(":", 1)[0]
    return image_name in OFFICIAL_NGINX_IMAGES


def _bind_mounts(inspect: dict[str, Any]) -> tuple[DockerMount, ...]:
    mounts = inspect.get("Mounts")
    if not isinstance(mounts, list):
        raise InstallerError("Docker Nginx 容器缺少 Mounts 检查信息；拒绝写入配置。")
    result: list[DockerMount] = []
    for mount in mounts:
        if not isinstance(mount, dict) or mount.get("Type") != "bind":
            continue
        source = mount.get("Source")
        destination = mount.get("Destination")
        if not isinstance(source, str) or not isinstance(destination, str):
            continue
        source_path = Path(source)
        destination_path = Path(destination)
        if not source_path.is_absolute() or not destination_path.is_absolute():
            continue
        result.append(DockerMount(source_path, destination_path))
    return tuple(result)


def _validated_bind_directory(source: Path, label: str) -> Path:
    if source.is_symlink() or not source.is_dir():
        raise InstallerError("Docker Nginx 的{0}宿主机挂载目录必须是已有的普通目录：{1}".format(label, source))
    resolved = source.resolve(strict=True)
    if not (resolved.stat().st_mode & 0o222) or not os.access(str(resolved), os.W_OK | os.X_OK):
        raise InstallerError("Docker Nginx 的{0}宿主机挂载目录不可写：{1}".format(label, source))
    return resolved


def _safe_config_path(mount: DockerMount, nested_conf_directory: bool) -> Path:
    source_root = _validated_bind_directory(mount.source, "配置")
    config_directory = source_root / "conf.d" if nested_conf_directory else source_root
    if config_directory.is_symlink() or not config_directory.is_dir():
        raise InstallerError(
            "Docker Nginx 配置目录必须存在且不能是软链接：{0}。请在宿主机挂载目录中创建 conf.d。".format(config_directory)
        )
    resolved_directory = config_directory.resolve(strict=True)
    if not path_is_within(resolved_directory, source_root):
        raise InstallerError("Docker Nginx 配置目录超出 inspect 确认的宿主机挂载范围；拒绝写入。")
    if not (resolved_directory.stat().st_mode & 0o222) or not os.access(str(resolved_directory), os.W_OK | os.X_OK):
        raise InstallerError("Docker Nginx 配置目标目录不可写：{0}".format(config_directory))
    config_path = config_directory / "slothvault.conf"
    if config_path.is_symlink() or (os.path.lexists(str(config_path)) and not config_path.is_file()):
        raise InstallerError("Docker Nginx 的 slothvault.conf 不是可安全覆盖的普通文件：{0}".format(config_path))
    resolved_candidate = config_path.resolve(strict=False)
    if not path_is_within(resolved_candidate, source_root):
        raise InstallerError("Docker Nginx 配置文件路径超出 inspect 确认的宿主机挂载范围；拒绝写入。")
    return config_path


class DockerNginxManager(NginxManager):
    """Manage an explicitly named official Nginx container through inspected host bind mounts."""

    mode = "docker"

    def __init__(
        self,
        docker: str,
        container_name: str,
        inspect: dict[str, Any],
        config_path: Path,
        config_mount: DockerMount,
    ) -> None:
        self.docker = docker
        self.container_name = container_name
        self.inspect = inspect
        self.config_path = config_path
        self.config_mount = config_mount

    @classmethod
    def discover(cls, container_name: str) -> "DockerNginxManager":
        name = validate_container_name(container_name)
        docker = shutil.which("docker")
        if docker is None:
            raise InstallerError("未找到 Docker 命令；无法管理 Docker Nginx 容器。")
        inspect = _docker_container_inspect(docker, name)
        state = inspect.get("State")
        if not isinstance(state, dict) or state.get("Running") is not True:
            raise InstallerError("Docker Nginx 容器未运行：{0}。请先启动该容器后重试。".format(name))
        config = inspect.get("Config")
        image = config.get("Image") if isinstance(config, dict) else None
        if not _official_nginx_image(image):
            raise InstallerError(
                "拒绝管理 Docker 镜像 {0}：仅支持官方 Docker Hub Nginx 镜像（nginx、library/nginx 或 docker.io/library/nginx）。".format(
                    image or "<未知>"
                )
            )
        mounts = _bind_mounts(inspect)
        direct_mount = next((mount for mount in mounts if mount.destination == Path("/etc/nginx/conf.d")), None)
        root_mount = next((mount for mount in mounts if mount.destination == Path("/etc/nginx")), None)
        if direct_mount is not None:
            config_path = _safe_config_path(direct_mount, nested_conf_directory=False)
            config_mount = direct_mount
        elif root_mount is not None:
            config_path = _safe_config_path(root_mount, nested_conf_directory=True)
            config_mount = root_mount
        else:
            raise InstallerError(
                "Docker Nginx 必须把 /etc/nginx/conf.d 或 /etc/nginx 配置目录以 bind mount 映射到宿主机；脚本不会修改容器内部临时文件，也不会重建容器。"
            )
        manager = cls(docker, name, inspect, config_path, config_mount)
        manager.validate_syntax()
        return manager

    def proxy_config(
        self,
        server_names: Sequence[str],
        http_port: int = 80,
        certificate_root: Optional[Path] = None,
    ) -> NginxProxyConfig:
        if not server_names:
            raise InstallerError("至少需要一个 Nginx 站点域名")
        return NginxProxyConfig(
            executable=self.docker,
            config_path=self.config_path,
            enabled_path=None,
            server_names=tuple(server_names),
            upstream_port=3000,
            http_port=http_port,
            upstream_host="slothvault",
            certificate_root=certificate_root or Path("/etc/letsencrypt"),
            manager=self,
        )

    def command(self, *arguments: str) -> tuple[str, ...]:
        return (self.docker, "exec", self.container_name, "nginx", *arguments)

    def validate_syntax(self) -> None:
        _docker_command_output(self.command("-t"), "Docker Nginx 命令或配置检查")

    def validate_site(self, proxy: NginxProxyConfig) -> None:
        self.validate_syntax()
        rendered_configuration = _docker_command_output(self.command("-T"), "Docker Nginx 最终配置检查")
        if MANAGED_NGINX_MARKER not in rendered_configuration:
            raise InstallerError("Docker Nginx 最终配置未加载 SlothVault 站点文件：{0}".format(proxy.config_path))

    def reload(self, proxy: NginxProxyConfig, allow_start: bool = True) -> None:
        _docker_command_output(self.command("-s", "reload"), "Docker Nginx 重载")

    def restore_validation_and_reload(self, proxy: NginxProxyConfig) -> None:
        self.validate_syntax()
        self.reload(proxy, allow_start=False)

    def _exact_host_bind_target(self, host_path: Path, label: str) -> Path:
        requested = host_path.resolve(strict=False)
        for mount in _bind_mounts(self.inspect):
            if mount.source.is_symlink() or not mount.source.is_dir():
                continue
            if mount.source.resolve(strict=True) == requested:
                return mount.destination
        raise InstallerError(
            "Docker Nginx 缺少 {0} 的 bind mount：宿主机 {1} 必须映射到容器中的明确目录。请补充挂载后重试。".format(
                label, host_path
            )
        )

    def https_container_paths(self, host_acme_webroot: Path) -> tuple[Path, Path]:
        acme_path = self._exact_host_bind_target(host_acme_webroot, "ACME Webroot")
        certificate_root = self._exact_host_bind_target(Path("/etc/letsencrypt"), "Let’s Encrypt 证书目录")
        return acme_path, certificate_root

    def ensure_shared_slothvault_network(self, application_inspect: dict[str, Any]) -> None:
        nginx_networks = _networks_from_inspect(self.inspect, "Docker Nginx")
        application_networks = _networks_from_inspect(application_inspect, "SlothVault 应用")
        shared = set(nginx_networks).intersection(application_networks)
        shared.discard("host")
        for network_name in sorted(shared):
            aliases = application_networks[network_name].get("Aliases")
            if isinstance(aliases, list) and "slothvault" in aliases:
                return
        raise InstallerError(
            "Docker Nginx 与 SlothVault 应用没有共享且包含 slothvault 别名的 Docker 网络。请先把官方 Nginx 容器连接到当前 SlothVault Compose 网络后重试。"
        )


def _networks_from_inspect(inspect: dict[str, Any], label: str) -> dict[str, dict[str, Any]]:
    settings = inspect.get("NetworkSettings")
    networks = settings.get("Networks") if isinstance(settings, dict) else None
    if not isinstance(networks, dict):
        raise InstallerError("无法读取{0}的 Docker 网络信息；拒绝生成不可靠的上游。".format(label))
    result: dict[str, dict[str, Any]] = {}
    for name, details in networks.items():
        if isinstance(name, str) and isinstance(details, dict):
            result[name] = details
    if not result:
        raise InstallerError("{0}未连接到可用 Docker 网络；拒绝生成不可靠的上游。".format(label))
    return result


def create_proxy_config(
    upstream_port: int,
    server_names: Sequence[str],
    http_port: int = 80,
) -> NginxProxyConfig:
    """Backward-compatible system Nginx factory retained for existing release callers."""

    return SystemNginxManager.discover().proxy_config(upstream_port, server_names, http_port)


def proxy_location_lines(proxy: NginxProxyConfig, indent: str = "    ") -> list[str]:
    return [
        "{0}location / {{".format(indent),
        "{0}    proxy_pass http://{1};".format(indent, proxy.upstream),
        "{0}    proxy_http_version 1.1;".format(indent),
        "{0}    proxy_set_header Host $host;".format(indent),
        "{0}    proxy_set_header X-Real-IP $remote_addr;".format(indent),
        "{0}    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;".format(indent),
        "{0}    proxy_set_header X-Forwarded-Proto $scheme;".format(indent),
        "{0}    proxy_set_header X-Forwarded-Host $host;".format(indent),
        "{0}}}".format(indent),
    ]


def render_http_proxy_config(proxy: NginxProxyConfig) -> str:
    lines = [
        MANAGED_NGINX_MARKER,
        "# Mode: HTTP reverse proxy",
        "# Upstream: http://{0}".format(proxy.upstream),
        "server {",
        "    listen {0};".format(proxy.http_port),
        "    server_name {0};".format(" ".join(proxy.server_names)),
        "",
    ]
    lines.extend(proxy_location_lines(proxy))
    lines.append("}")
    return "\n".join(lines) + "\n"


def acme_location_lines(acme_webroot: Path) -> list[str]:
    return [
        "    location ^~ /.well-known/acme-challenge/ {",
        "        root {0};".format(acme_webroot),
        "        default_type text/plain;",
        "        try_files $uri =404;",
        "    }",
    ]


def render_acme_http_config(proxy: NginxProxyConfig, acme_webroot: Path) -> str:
    lines = [
        MANAGED_NGINX_MARKER,
        "# Mode: HTTP-01 certificate staging",
        "# Upstream: http://{0}".format(proxy.upstream),
        "server {",
        "    listen 80;",
        "    server_name {0};".format(" ".join(proxy.server_names)),
        "",
    ]
    lines.extend(acme_location_lines(acme_webroot))
    lines.append("")
    lines.extend(proxy_location_lines(proxy))
    lines.append("}")
    return "\n".join(lines) + "\n"


def render_https_proxy_config(proxy: NginxProxyConfig, acme_webroot: Path) -> str:
    certificate_dir = proxy.certificate_root / "live" / proxy.primary_server_name
    lines = [
        MANAGED_NGINX_MARKER,
        "# Mode: HTTPS with Let's Encrypt",
        "# Certificate primary domain: {0}".format(proxy.primary_server_name),
        "# Upstream: http://{0}".format(proxy.upstream),
        "server {",
        "    listen 80;",
        "    server_name {0};".format(" ".join(proxy.server_names)),
        "",
    ]
    lines.extend(acme_location_lines(acme_webroot))
    lines.extend(
        [
            "",
            "    location / {",
            "        return 301 https://$host$request_uri;",
            "    }",
            "}",
            "",
            "server {",
            "    listen 443 ssl;",
            "    server_name {0};".format(" ".join(proxy.server_names)),
            "",
            "    ssl_certificate {0};".format(certificate_dir / "fullchain.pem"),
            "    ssl_certificate_key {0};".format(certificate_dir / "privkey.pem"),
            "",
        ]
    )
    lines.extend(proxy_location_lines(proxy))
    lines.append("}")
    return "\n".join(lines) + "\n"


def snapshot_nginx_site(proxy: NginxProxyConfig) -> NginxSiteSnapshot:
    if not os.path.lexists(str(proxy.config_path)):
        return NginxSiteSnapshot(None, 0o644, bool(proxy.enabled_path and os.path.lexists(str(proxy.enabled_path))))
    if proxy.config_path.is_symlink() or not proxy.config_path.is_file():
        raise InstallerError("Nginx 站点配置不是普通文件：{0}".format(proxy.config_path))
    try:
        source = proxy.config_path.read_text(encoding="utf-8")
    except OSError as error:
        raise InstallerError("无法读取 Nginx 站点配置：{0}".format(proxy.config_path)) from error
    if not any(marker in source for marker in MANAGED_NGINX_MARKERS):
        raise InstallerError("拒绝覆盖非 SlothVault 生成的 Nginx 站点配置：{0}".format(proxy.config_path))
    return NginxSiteSnapshot(
        source=source,
        mode=proxy.config_path.stat().st_mode & 0o777,
        enabled_link_existed=bool(proxy.enabled_path and os.path.lexists(str(proxy.enabled_path))),
    )


def _manager_for(proxy: NginxProxyConfig) -> NginxManager:
    if proxy.manager is not None:
        return proxy.manager
    return SystemNginxManager(proxy.executable, proxy.config_path, proxy.enabled_path)


def enable_nginx_site(proxy: NginxProxyConfig) -> bool:
    return _manager_for(proxy).enable_site(proxy)


def validate_nginx_site(proxy: NginxProxyConfig) -> None:
    _manager_for(proxy).validate_site(proxy)


def reload_nginx(proxy: NginxProxyConfig, allow_start: bool = True) -> None:
    _manager_for(proxy).reload(proxy, allow_start=allow_start)


def restore_nginx_site(proxy: NginxProxyConfig, snapshot: NginxSiteSnapshot) -> None:
    try:
        if snapshot.source is None:
            proxy.config_path.unlink(missing_ok=True)
        else:
            write_text_atomically(proxy.config_path, snapshot.source, snapshot.mode)
        if (
            proxy.enabled_path is not None
            and not snapshot.enabled_link_existed
            and os.path.lexists(str(proxy.enabled_path))
        ):
            proxy.enabled_path.unlink()
        _manager_for(proxy).restore_validation_and_reload(proxy)
    except (InstallerError, OSError) as error:
        from .system import print_error

        print_error("恢复 Nginx 站点配置失败，请手工检查 {0}：{1}".format(proxy.config_path, error))


def apply_nginx_site(proxy: NginxProxyConfig, source: str) -> NginxSiteSnapshot:
    snapshot = snapshot_nginx_site(proxy)
    try:
        write_text_atomically(proxy.config_path, source, snapshot.mode)
        enable_nginx_site(proxy)
        validate_nginx_site(proxy)
        reload_nginx(proxy)
    except (InstallerError, OSError):
        restore_nginx_site(proxy, snapshot)
        raise
    return snapshot


def certificate_name_from_site(proxy: NginxProxyConfig) -> Optional[str]:
    snapshot = snapshot_nginx_site(proxy)
    if snapshot.source is None:
        return None
    match = CERTIFICATE_NAME_PATTERN.search(snapshot.source)
    return match.group("name") if match else None
