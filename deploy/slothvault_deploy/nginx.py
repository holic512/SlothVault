"""
@file deploy/slothvault_deploy/nginx.py
@project SlothVault
@module Deployment Nginx management
@description Creates and updates one safely owned SlothVault Nginx site for HTTP proxying and HTTPS termination.
@logic Restrict writes to managed standard Nginx site locations, validate and reload every generated configuration, and restore the prior managed site on failure.
@dependencies Python standard library, host Nginx
@index_tags deployment,installer,nginx,reverse-proxy,https,acme,rollback
@author holic512
"""

from __future__ import annotations

import ipaddress
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence

from .system import InstallerError, command_succeeds, prompt_yes_no, run_command, write_text_atomically


MANAGED_NGINX_MARKER = "# Managed by SlothVault deploy installer"
LEGACY_MANAGED_NGINX_MARKER = "# Managed by SlothVault install.py"
MANAGED_NGINX_MARKERS = (MANAGED_NGINX_MARKER, LEGACY_MANAGED_NGINX_MARKER)
CERTIFICATE_NAME_PATTERN = re.compile(r"^# Certificate primary domain: (?P<name>[A-Za-z0-9.-]+)$", re.MULTILINE)


@dataclass(frozen=True)
class NginxProxyConfig:
    """The generated Nginx site for one local SlothVault application port."""

    executable: str
    config_path: Path
    enabled_path: Optional[Path]
    server_names: tuple[str, ...]
    upstream_port: int
    http_port: int = 80

    @property
    def primary_server_name(self) -> str:
        return self.server_names[0]


@dataclass(frozen=True)
class NginxSiteSnapshot:
    """The existing managed site state used for a recoverable write."""

    source: Optional[str]
    mode: int
    enabled_link_existed: bool


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


def find_nginx() -> Optional[str]:
    executable = shutil.which("nginx")
    if executable:
        return executable
    return None


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


def create_proxy_config(
    upstream_port: int,
    server_names: Sequence[str],
    http_port: int = 80,
) -> NginxProxyConfig:
    if not server_names:
        raise InstallerError("至少需要一个 Nginx 站点域名")
    executable = require_nginx()
    config_path, enabled_path = nginx_site_paths()
    return NginxProxyConfig(
        executable=executable,
        config_path=config_path,
        enabled_path=enabled_path,
        server_names=tuple(server_names),
        upstream_port=upstream_port,
        http_port=http_port,
    )


def proxy_location_lines(proxy: NginxProxyConfig, indent: str = "    ") -> list[str]:
    return [
        "{0}location / {{".format(indent),
        "{0}    proxy_pass http://127.0.0.1:{1};".format(indent, proxy.upstream_port),
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
        "# Upstream: http://127.0.0.1:{0}".format(proxy.upstream_port),
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
        "# Upstream: http://127.0.0.1:{0}".format(proxy.upstream_port),
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
    certificate_dir = Path("/etc/letsencrypt/live") / proxy.primary_server_name
    lines = [
        MANAGED_NGINX_MARKER,
        "# Mode: HTTPS with Let's Encrypt",
        "# Certificate primary domain: {0}".format(proxy.primary_server_name),
        "# Upstream: http://127.0.0.1:{0}".format(proxy.upstream_port),
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


def enable_nginx_site(proxy: NginxProxyConfig) -> bool:
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


def nginx_command_output(command: Sequence[str]) -> str:
    try:
        result = subprocess.run(list(command), text=True, capture_output=True, check=False)
    except FileNotFoundError as error:
        raise InstallerError("未找到 Nginx 命令：{0}".format(command[0])) from error
    output = "{0}\n{1}".format(result.stdout, result.stderr).strip()
    if result.returncode != 0:
        summary = output[-2000:] if output else "没有输出"
        raise InstallerError("Nginx 配置检查失败：{0}".format(summary))
    return output


def validate_nginx_site(proxy: NginxProxyConfig) -> None:
    nginx_command_output((proxy.executable, "-t"))
    rendered_configuration = nginx_command_output((proxy.executable, "-T"))
    if MANAGED_NGINX_MARKER not in rendered_configuration:
        raise InstallerError("Nginx 主配置未包含新站点文件：{0}".format(proxy.config_path))


def reload_nginx(proxy: NginxProxyConfig, allow_start: bool = True) -> None:
    systemctl = shutil.which("systemctl")
    if systemctl:
        if command_succeeds((systemctl, "is-active", "--quiet", "nginx")):
            run_command((systemctl, "reload", "nginx"))
            return
        if allow_start and prompt_yes_no("Nginx 服务当前未运行，是否立即启动它"):
            run_command((systemctl, "start", "nginx"))
            return
        raise InstallerError("Nginx 已写入并通过配置检查，但尚未启动；未切换应用端口")
    run_command((proxy.executable, "-s", "reload"))


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
        nginx_command_output((proxy.executable, "-t"))
        systemctl = shutil.which("systemctl")
        if systemctl and command_succeeds((systemctl, "is-active", "--quiet", "nginx")):
            run_command((systemctl, "reload", "nginx"))
        elif not systemctl:
            run_command((proxy.executable, "-s", "reload"))
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
