"""
@file deploy/slothvault_deploy/certbot.py
@project SlothVault
@module Deployment certificate management
@description Installs Certbot from supported Linux package managers, obtains HTTP-01 certificates and configures safe automatic renewal hooks.
@logic Use a script-owned ACME webroot and Nginx configuration, never delegate Nginx edits to Certbot, then reuse an active Certbot timer or create a managed timer or cron fallback.
@dependencies Python standard library, Certbot, host Nginx, systemd or cron
@index_tags deployment,installer,certbot,lets-encrypt,https,acme,renewal,systemd,cron
@author holic512
"""

from __future__ import annotations

import os
import re
import shutil
import socket
from pathlib import Path
from typing import Iterable, Optional, Sequence

from .nginx import NginxProxyConfig, validate_server_name
from .system import (
    InstallerError,
    command_succeeds,
    print_info,
    read_os_release,
    require_root,
    run_command,
    write_text_atomically,
)


CERTBOT_HOOK_MARKER = "# Managed by SlothVault deploy installer"
RENEWAL_HOOK_PATH = Path("/etc/letsencrypt/renewal-hooks/deploy/slothvault-reload-nginx")
SYSTEMD_SERVICE_PATH = Path("/etc/systemd/system/slothvault-certbot-renew.service")
SYSTEMD_TIMER_PATH = Path("/etc/systemd/system/slothvault-certbot-renew.timer")
CRON_RENEWAL_PATH = Path("/etc/cron.d/slothvault-certbot-renew")
CRON_WRAPPER_PATH = Path("/usr/local/sbin/slothvault-certbot-renew")
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def validate_certificate_domains(raw_domains: Iterable[str]) -> tuple[str, ...]:
    domains: list[str] = []
    for raw_domain in raw_domains:
        domain = validate_server_name(raw_domain, allow_ip=False)
        if domain not in domains:
            domains.append(domain)
    if not domains:
        raise InstallerError("至少需要一个用于 Let's Encrypt 的 DNS 域名")
    return tuple(domains)


def validate_email(value: str) -> str:
    email = value.strip()
    if not EMAIL_PATTERN.fullmatch(email):
        raise InstallerError("请输入有效的 Let's Encrypt 联系邮箱")
    return email


def resolve_domains(domains: Sequence[str]) -> dict[str, bool]:
    results: dict[str, bool] = {}
    for domain in domains:
        try:
            socket.getaddrinfo(domain, 80, type=socket.SOCK_STREAM)
        except socket.gaierror:
            results[domain] = False
        else:
            results[domain] = True
    return results


def prepare_acme_webroot(root: Path) -> Path:
    if not root.is_dir():
        raise InstallerError("未找到 SlothVault 部署根目录：{0}".format(root))
    # 只允许 Nginx 穿过部署根目录访问公开的挑战目录；data、mysql、postgresql 与 compose.yml 仍保持私有权限。
    os.chmod(str(root), 0o711)
    webroot = root / "acme-challenge"
    challenge_directory = webroot / ".well-known" / "acme-challenge"
    challenge_directory.mkdir(parents=True, exist_ok=True, mode=0o755)
    for directory in (webroot, webroot / ".well-known", challenge_directory):
        os.chmod(str(directory), 0o755)
    return webroot


def certbot_executable() -> Optional[str]:
    return shutil.which("certbot")


def ensure_certbot() -> str:
    executable = certbot_executable()
    if executable:
        return executable
    require_root("自动安装 Certbot")
    os_release = read_os_release()
    identifiers = set()
    for key in ("ID", "ID_LIKE"):
        identifiers.update(os_release.get(key, "").lower().split())

    if identifiers & {"debian", "ubuntu"}:
        manager = shutil.which("apt-get")
        if manager is None:
            raise InstallerError("系统标识为 Debian/Ubuntu，但未找到 apt-get；请由管理员安装 Certbot 后重试")
        try:
            run_command((manager, "update"))
            run_command((manager, "install", "-y", "certbot"))
        except InstallerError as error:
            raise InstallerError("无法通过 apt-get 安装 Certbot；请由管理员处理软件源后重试：{0}".format(error)) from error
    elif identifiers & {"fedora", "rhel", "centos", "rocky", "almalinux"}:
        manager = shutil.which("dnf")
        if manager is None:
            raise InstallerError("系统标识为 Fedora/RHEL，但未找到 dnf；请由管理员安装 Certbot 后重试")
        try:
            run_command((manager, "install", "-y", "certbot"))
        except InstallerError as error:
            raise InstallerError(
                "无法通过 dnf 安装 Certbot（RHEL 可能缺少已启用的软件源）；脚本不会自动添加第三方仓库或 Snap。请由管理员安装后重试：{0}".format(error)
            ) from error
    else:
        identifier = os_release.get("ID", "未知发行版")
        raise InstallerError(
            "当前仅自动安装 Debian/Ubuntu 与 Fedora/RHEL 的 Certbot；检测到 {0}。请由管理员安装 Certbot 后重试。".format(identifier)
        )

    executable = certbot_executable()
    if executable is None:
        raise InstallerError("Certbot 安装命令已完成，但仍未在 PATH 中找到 certbot")
    return executable


def certificate_paths(primary_domain: str) -> tuple[Path, Path]:
    directory = Path("/etc/letsencrypt/live") / primary_domain
    return directory / "fullchain.pem", directory / "privkey.pem"


def issue_certificate(
    executable: str,
    domains: Sequence[str],
    email: str,
    acme_webroot: Path,
) -> None:
    command: list[str] = [
        executable,
        "certonly",
        "--webroot",
        "--non-interactive",
        "--agree-tos",
        "--email",
        email,
        "--keep-until-expiring",
        "-w",
        str(acme_webroot),
    ]
    for domain in domains:
        command.extend(("-d", domain))
    run_command(tuple(command))
    fullchain, private_key = certificate_paths(domains[0])
    if not fullchain.is_file() or not private_key.is_file():
        raise InstallerError(
            "Certbot 已结束，但未找到主域名证书文件：{0} 与 {1}".format(fullchain, private_key)
        )


def write_managed_host_file(path: Path, source: str, mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    if os.path.lexists(str(path)):
        if path.is_symlink() or not path.is_file():
            raise InstallerError("受管理的系统文件不是普通文件：{0}".format(path))
        existing = path.read_text(encoding="utf-8")
        if CERTBOT_HOOK_MARKER not in existing:
            raise InstallerError("拒绝覆盖非 SlothVault 生成的系统文件：{0}".format(path))
        mode = path.stat().st_mode & 0o777
    write_text_atomically(path, source, mode)


def renewal_hook_source(nginx_executable: str) -> str:
    return """#!/bin/sh
{marker}
set -eu

if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
    exec systemctl reload nginx
fi
exec {nginx} -s reload
""".format(marker=CERTBOT_HOOK_MARKER, nginx=nginx_executable)


def install_renewal_deploy_hook(nginx_executable: str) -> None:
    write_managed_host_file(RENEWAL_HOOK_PATH, renewal_hook_source(nginx_executable), 0o755)
    print_info("已配置证书续约成功后的 Nginx 重载 hook：{0}".format(RENEWAL_HOOK_PATH))


def existing_certbot_timer() -> Optional[str]:
    systemctl = shutil.which("systemctl")
    if systemctl is None or not Path("/run/systemd/system").exists():
        return None
    for timer in ("certbot.timer", "certbot-renew.timer"):
        if command_succeeds((systemctl, "is-enabled", "--quiet", timer)) and command_succeeds(
            (systemctl, "is-active", "--quiet", timer)
        ):
            return timer
    return None


def managed_systemd_service_source(certbot: str) -> str:
    return """# Managed by SlothVault deploy installer
[Unit]
Description=Renew Let's Encrypt certificates for SlothVault

[Service]
Type=oneshot
ExecStart={certbot} renew --quiet
""".format(certbot=certbot)


def managed_systemd_timer_source() -> str:
    return """# Managed by SlothVault deploy installer
[Unit]
Description=Run SlothVault Certbot renewal twice daily

[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=3600
Persistent=true

[Install]
WantedBy=timers.target
"""


def managed_cron_wrapper_source(certbot: str) -> str:
    return """#!/bin/sh
# Managed by SlothVault deploy installer
set -eu

delay="$(od -An -N2 -tu2 /dev/urandom | tr -d ' ')"
sleep "$((delay % 3600))"
exec {certbot} renew --quiet
""".format(certbot=certbot)


def managed_cron_source() -> str:
    return """# Managed by SlothVault deploy installer
0 3,15 * * * root {wrapper}
""".format(wrapper=CRON_WRAPPER_PATH)


def configure_automatic_renewal(certbot: str) -> str:
    require_root("配置证书自动续约")
    timer = existing_certbot_timer()
    if timer:
        print_info("检测到已启用的 Certbot 自动续约 timer：{0}".format(timer))
        return "复用 {0}".format(timer)

    systemctl = shutil.which("systemctl")
    if systemctl and Path("/run/systemd/system").exists():
        write_managed_host_file(SYSTEMD_SERVICE_PATH, managed_systemd_service_source(certbot), 0o644)
        write_managed_host_file(SYSTEMD_TIMER_PATH, managed_systemd_timer_source(), 0o644)
        run_command((systemctl, "daemon-reload"))
        run_command((systemctl, "enable", "--now", "slothvault-certbot-renew.timer"))
        return "已启用 slothvault-certbot-renew.timer"

    write_managed_host_file(CRON_WRAPPER_PATH, managed_cron_wrapper_source(certbot), 0o755)
    write_managed_host_file(CRON_RENEWAL_PATH, managed_cron_source(), 0o644)
    return "已写入 {0}（系统未运行 systemd）".format(CRON_RENEWAL_PATH)


def renew_certificate(executable: str, dry_run: bool = False) -> None:
    command: list[str] = [executable, "renew", "--quiet"]
    if dry_run:
        command.extend(("--dry-run", "--run-deploy-hooks"))
    run_command(tuple(command))


def describe_certificate(primary_domain: str) -> str:
    fullchain, private_key = certificate_paths(primary_domain)
    if fullchain.is_file() and private_key.is_file():
        return "已找到证书文件：{0}".format(fullchain)
    return "未找到 {0} 的 Let’s Encrypt 证书文件".format(primary_domain)
