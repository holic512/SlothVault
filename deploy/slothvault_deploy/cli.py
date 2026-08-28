"""
@file deploy/slothvault_deploy/cli.py
@project SlothVault
@module Deployment command-line interface
@description Provides the Chinese interactive menu that coordinates Docker Compose installation with safely selected system or official Docker Nginx reverse proxying and Let’s Encrypt certificate operations.
@logic Resolve one explicit Nginx management mode per action, preserve existing managed state, verify Docker upstream networking before rendering it, and sequence Compose, Nginx and Certbot changes so high-risk writes have a recoverable path.
@dependencies Python standard library, Docker Engine, Docker Compose v2, optional host Nginx and Certbot
@index_tags deployment,installer,cli,menu,compose,nginx,docker,https,certbot
@author holic512
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import replace
from pathlib import Path
from typing import Optional, Sequence

from . import __version__
from .certbot import (
    configure_automatic_renewal,
    describe_certificate,
    ensure_certbot,
    install_renewal_deploy_hook,
    issue_certificate,
    prepare_acme_webroot,
    renew_certificate,
    resolve_domains,
    validate_certificate_domains,
    validate_email,
)
from .compose import (
    COMPOSE_FILE_NAME,
    DEFAULT_ROOT,
    PROVIDERS,
    bind_existing_application_to_loopback,
    compose_command,
    configure_installation,
    inspect_managed_application,
    operate_existing,
    read_published_application_port,
    render_compose,
    require_managed_compose,
    restore_compose,
    write_private_compose,
)
from .nginx import (
    DockerNginxManager,
    NginxManager,
    NginxProxyConfig,
    SystemNginxManager,
    apply_nginx_site,
    certificate_name_from_site,
    find_nginx,
    render_acme_http_config,
    render_http_proxy_config,
    render_https_proxy_config,
    restore_nginx_site,
    snapshot_nginx_site,
    validate_container_name,
    validate_server_name,
)
from .system import (
    InstallerError,
    check_docker,
    normalize_path,
    print_error,
    print_info,
    prompt_confirm,
    prompt_value,
    prompt_yes_no,
    require_root,
    run_command,
    validate_port,
)


ACTIONS = ("install", "update", "start", "stop", "status", "nginx", "https", "renew")
NGINX_MODES = ("auto", "system", "docker")


def prompt_action(default: Optional[str] = None) -> str:
    if default:
        return default
    choices = {
        "1": "install",
        "2": "update",
        "3": "start",
        "4": "stop",
        "5": "status",
        "6": "nginx",
        "7": "https",
        "8": "renew",
    }
    print("\n请选择操作：")
    print("  1) 安装新实例并生成 compose.yml")
    print("  2) 拉取最新镜像并更新现有实例")
    print("  3) 启动现有实例")
    print("  4) 停止现有实例（保留持久化数据）")
    print("  5) 查看现有实例状态")
    print("  6) 配置或更新 Nginx 反向代理")
    print("  7) 申请或更新 Let's Encrypt HTTPS 证书")
    print("  8) 查看证书状态或立即尝试续约")
    while True:
        try:
            selected = input("操作 [1]: ").strip() or "1"
        except EOFError as error:
            raise InstallerError("尚未选择操作，输入已结束") from error
        action = choices.get(selected)
        if action:
            return action
        print_error("请输入 1 到 8 的数字")


def prompt_http_server_name() -> str:
    while True:
        try:
            value = input("Nginx 站点域名或 IPv4 地址：").strip()
        except EOFError as error:
            raise InstallerError("尚未输入 Nginx 站点域名，输入已结束") from error
        try:
            return validate_server_name(value)
        except InstallerError as error:
            print_error(str(error))


def prompt_certificate_domains() -> tuple[str, ...]:
    while True:
        try:
            raw_value = input("Let's Encrypt 域名（多个域名用空格或逗号分隔，首个为主域名）：").strip()
        except EOFError as error:
            raise InstallerError("尚未输入证书域名，输入已结束") from error
        try:
            return validate_certificate_domains(value for value in re.split(r"[\s,]+", raw_value) if value)
        except InstallerError as error:
            print_error(str(error))


def prompt_docker_nginx_container() -> str:
    while True:
        try:
            value = input("官方 Docker Nginx 容器名：").strip()
        except EOFError as error:
            raise InstallerError("Docker Nginx 模式必须明确提供 --nginx-container 或输入容器名，输入已结束") from error
        try:
            return validate_container_name(value)
        except InstallerError as error:
            print_error(str(error))


def resolved_nginx_mode(arguments: argparse.Namespace) -> str:
    container_name = arguments.nginx_container
    if arguments.nginx_mode == "system" and container_name:
        raise InstallerError("--nginx-mode system 不能与 --nginx-container 同时使用；请只选择一种 Nginx 管理模式。")
    if container_name:
        return "docker"
    return arguments.nginx_mode


def resolve_nginx_manager(arguments: argparse.Namespace) -> Optional[NginxManager]:
    """Resolve exactly one safe Nginx manager; auto never scans Docker containers."""

    mode = resolved_nginx_mode(arguments)
    if mode == "docker":
        container_name = arguments.nginx_container or prompt_docker_nginx_container()
        manager = DockerNginxManager.discover(container_name)
        print_info("已选择官方 Docker Nginx 容器：{0}".format(manager.container_name))
        return manager
    executable = find_nginx()
    if executable is None:
        if mode == "auto":
            print_info("未检测到宿主机 Nginx（或 nginx 不在 PATH 中）；自动模式不会扫描或接管 Docker 容器。")
            return None
        raise InstallerError("未检测到宿主机 Nginx（或 nginx 不在 PATH 中）；脚本不会自动安装 Nginx。")
    manager = SystemNginxManager.discover()
    print_info("已选择系统级 Nginx：{0}".format(manager.executable))
    return manager


def proxy_config_for_manager(
    manager: NginxManager,
    upstream_port: int,
    server_names: Sequence[str],
    http_port: int,
    certificate_root: Optional[Path] = None,
) -> NginxProxyConfig:
    if isinstance(manager, DockerNginxManager):
        return manager.proxy_config(server_names, http_port, certificate_root)
    if isinstance(manager, SystemNginxManager):
        return manager.proxy_config(upstream_port, server_names, http_port)
    raise InstallerError("Nginx 管理模式无效；拒绝写入配置。")


def verify_docker_upstream(proxy: NginxProxyConfig, compose_path: Path) -> None:
    manager = proxy.manager
    if isinstance(manager, DockerNginxManager):
        manager.ensure_shared_slothvault_network(inspect_managed_application(compose_path))


def configure_interactive_http_proxy(
    arguments: argparse.Namespace, upstream_port: int
) -> Optional[NginxProxyConfig]:
    manager = resolve_nginx_manager(arguments)
    if manager is None:
        return None
    if not prompt_yes_no("是否配置 Nginx 反向代理（应用端口将仅绑定到 127.0.0.1）"):
        return None
    require_root("配置 Nginx")
    server_name = prompt_http_server_name()
    http_port = validate_port(prompt_value("Nginx 对外 HTTP 监听端口", "80"))
    return proxy_config_for_manager(manager, upstream_port, (server_name,), http_port)


def print_deployment_confirmation(config: object, proxy: Optional[NginxProxyConfig]) -> None:
    print("\n部署配置确认：")
    print("  数据库类型：{0}".format(config.provider))
    print("  Compose 文件：{0}".format(config.compose_path))
    print("  应用数据目录：{0}".format(config.data_dir))
    if config.database_dir:
        print("  数据库存储目录：{0}".format(config.database_dir))
    print("  HTTP 端口：{0}".format(config.port))
    print("  Docker 镜像：{0}".format(config.image))
    if proxy:
        print("  Nginx 站点：{0}:{1}".format(proxy.primary_server_name, proxy.http_port))
        print("  Nginx 上游：http://{0}".format(proxy.upstream))
        print("  应用端口：仅绑定到 127.0.0.1，由 Nginx 对外代理")


def install(arguments: argparse.Namespace, root: Path) -> None:
    config = configure_installation(arguments, root)
    proxy = configure_interactive_http_proxy(arguments, config.port)
    original_compose_source: Optional[str] = None
    if proxy:
        original_compose_source = render_compose(config)
        config = replace(config, bind_loopback=True)
    print_deployment_confirmation(config, proxy)
    prompt_confirm("确认创建该新部署")
    write_private_compose(config)
    print_info("已生成 {0}，文件权限为 0600".format(config.compose_path))
    run_command(compose_command(config.compose_path, "pull"))
    if proxy and not isinstance(proxy.manager, DockerNginxManager):
        apply_nginx_site(proxy, render_http_proxy_config(proxy))
    run_command(compose_command(config.compose_path, "up", "-d"))
    if proxy and isinstance(proxy.manager, DockerNginxManager):
        try:
            verify_docker_upstream(proxy, config.compose_path)
            apply_nginx_site(proxy, render_http_proxy_config(proxy))
        except InstallerError:
            if original_compose_source is not None:
                try:
                    restore_compose(config.compose_path, original_compose_source)
                    run_command(compose_command(config.compose_path, "up", "-d"))
                except InstallerError as error:
                    print_error("Docker Nginx 网络预检失败后无法恢复应用端口映射，请手工检查 {0}：{1}".format(config.compose_path, error))
            raise
    run_command(compose_command(config.compose_path, "ps"))
    print_info("首次启动时会自动初始化数据库 schema。")
    if proxy:
        print_info("Nginx 已代理到 {0}；请通过 http://{1}:{2} 访问。".format(proxy.upstream, proxy.primary_server_name, proxy.http_port))
    else:
        print_info("服务启动后，请访问 http://<服务器地址>:{0}/install 创建首位管理员。".format(config.port))


def configure_existing_nginx(arguments: argparse.Namespace, root: Path) -> None:
    compose_path = root / COMPOSE_FILE_NAME
    require_managed_compose(compose_path)
    source, port, already_loopback = read_published_application_port(compose_path)
    proxy = configure_interactive_http_proxy(arguments, port)
    if proxy is None:
        return
    verify_docker_upstream(proxy, compose_path)
    existing_certificate = certificate_name_from_site(proxy)
    if existing_certificate:
        raise InstallerError(
            "当前受管理站点已启用 {0} 的 HTTPS。请使用“申请或更新 Let's Encrypt HTTPS 证书”菜单，避免将证书站点降级为 HTTP。".format(existing_certificate)
        )
    print("\nNginx 反向代理确认：")
    print("  站点域名：{0}".format(proxy.primary_server_name))
    print("  Nginx HTTP 端口：{0}".format(proxy.http_port))
    print("  代理目标：http://{0}".format(proxy.upstream))
    print("  应用端口：{0}".format("已仅绑定到 127.0.0.1" if already_loopback else "将改为仅绑定到 127.0.0.1"))
    prompt_confirm("确认写入并启用 Nginx 反向代理")
    apply_nginx_site(proxy, render_http_proxy_config(proxy))
    if not already_loopback:
        bind_existing_application_to_loopback(compose_path, source)
    run_command(compose_command(compose_path, "up", "-d"))
    print_info("Nginx 反向代理已配置；持久化数据未发生变化。")


def rollback_https_setup(
    proxy: NginxProxyConfig,
    nginx_snapshot: object,
    compose_path: Path,
    compose_source: str,
    changed_loopback: bool,
) -> None:
    restore_nginx_site(proxy, nginx_snapshot)
    if changed_loopback:
        try:
            restore_compose(compose_path, compose_source)
            run_command(compose_command(compose_path, "up", "-d"))
        except InstallerError as error:
            print_error("恢复原 Compose 端口映射失败，请手工检查 {0}：{1}".format(compose_path, error))


def configure_https(arguments: argparse.Namespace, root: Path) -> None:
    require_root("配置 Let's Encrypt HTTPS")
    compose_path = root / COMPOSE_FILE_NAME
    require_managed_compose(compose_path)
    compose_source, port, already_loopback = read_published_application_port(compose_path)
    manager = resolve_nginx_manager(arguments)
    if manager is None:
        raise InstallerError("无法配置 HTTPS：未检测到可用的系统级 Nginx。")
    domains = prompt_certificate_domains()
    email = prompt_value("Let's Encrypt 联系邮箱", "", validate_email)
    resolution = resolve_domains(domains)
    print("\nHTTPS 申请前检查：")
    for domain, resolved in resolution.items():
        print("  DNS {0}：{1}".format(domain, "本机解析成功" if resolved else "本机未解析"))
    print("  HTTP-01 验证：Nginx 将监听公网 80 端口")
    print("  HTTPS 服务：Nginx 将监听公网 443 端口，并将其他 HTTP 请求 301 跳转到 HTTPS")
    print("  DNS 与防火墙：请确认每个域名的 A/AAAA 已指向本服务器且公网 80 端口可访问")
    print("  服务条款：https://letsencrypt.org/repository/")
    if not already_loopback:
        print("  应用端口：将改为仅绑定到 127.0.0.1，避免绕过 Nginx 直接访问")
    prompt_confirm("确认同意 Let's Encrypt 服务条款并开始申请证书")

    acme_host_webroot = prepare_acme_webroot(root)
    acme_config_webroot = acme_host_webroot
    certificate_root: Optional[Path] = None
    if isinstance(manager, DockerNginxManager):
        manager.ensure_shared_slothvault_network(inspect_managed_application(compose_path))
        acme_config_webroot, certificate_root = manager.https_container_paths(acme_host_webroot)
    proxy = proxy_config_for_manager(manager, port, domains, 80, certificate_root)
    nginx_snapshot = snapshot_nginx_site(proxy)
    certbot = ensure_certbot()
    changed_loopback = False
    try:
        apply_nginx_site(proxy, render_acme_http_config(proxy, acme_config_webroot))
        if not already_loopback:
            changed_loopback = bind_existing_application_to_loopback(compose_path, compose_source)
            if changed_loopback:
                run_command(compose_command(compose_path, "up", "-d"))
        issue_certificate(certbot, domains, email, acme_host_webroot)
    except InstallerError:
        rollback_https_setup(proxy, nginx_snapshot, compose_path, compose_source, changed_loopback)
        raise

    try:
        apply_nginx_site(proxy, render_https_proxy_config(proxy, acme_config_webroot))
    except InstallerError as error:
        raise InstallerError(
            "证书已签发，但 HTTPS 配置未能启用；脚本已恢复临时 HTTP 反向代理，自动续约尚未配置。证书文件仍在 /etc/letsencrypt/live/{0}/：{1}".format(domains[0], error)
        ) from error

    try:
        install_renewal_deploy_hook(proxy.manager or proxy.executable)
        renewal_description = configure_automatic_renewal(certbot)
        renew_certificate(certbot, dry_run=True)
    except InstallerError as error:
        raise InstallerError("HTTPS 已启用，但自动续约配置或续约演练未完成；请在证书到期前处理：{0}".format(error)) from error
    print_info("Let's Encrypt HTTPS 已启用（{0}）；{1}。".format(domains[0], renewal_description))
    print_info("请通过 https://{0}/install 创建首位管理员或继续使用现有实例。".format(domains[0]))


def certificate_status_or_renew(arguments: argparse.Namespace, root: Path) -> None:
    require_root("查看或续约证书")
    compose_path = root / COMPOSE_FILE_NAME
    require_managed_compose(compose_path)
    _, port, _ = read_published_application_port(compose_path)
    manager = resolve_nginx_manager(arguments)
    if manager is None:
        raise InstallerError("无法读取 SlothVault HTTPS 证书状态：未检测到可用的系统级 Nginx。")
    proxy = proxy_config_for_manager(manager, port, ("slothvault.invalid",), 80)
    verify_docker_upstream(proxy, compose_path)
    primary_domain = certificate_name_from_site(proxy)
    if primary_domain is None:
        raise InstallerError("当前受管理的 Nginx 站点未启用 Let's Encrypt HTTPS；请先选择“申请或更新 HTTPS 证书”。")
    print_info(describe_certificate(primary_domain))
    if not prompt_yes_no("是否立即运行 certbot renew 尝试续约（Certbot 会检查本机全部证书）"):
        return
    certbot = ensure_certbot()
    renew_certificate(certbot)
    print_info("Certbot 续约检查已完成。自动续约由已配置的 timer 或 cron 继续执行。")


def parse_arguments(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成并管理独立的 SlothVault Docker Compose 部署。")
    parser.add_argument("--action", choices=ACTIONS, help="跳过交互式操作选择。")
    parser.add_argument("--root", help="部署根目录，默认 /data/slothvault。")
    parser.add_argument("--provider", choices=PROVIDERS, help="新安装时跳过数据库类型选择。")
    parser.add_argument("--data-dir", help="应用持久化数据目录。")
    parser.add_argument("--database-dir", help="MySQL 或 PostgreSQL 数据库持久化目录。")
    parser.add_argument("--image", help="SlothVault Docker 镜像，默认发布的 latest 镜像。")
    parser.add_argument("--port", help="宿主机 HTTP 端口，默认 3000。")
    parser.add_argument(
        "--encryption-key",
        help="可选的 43 字符 base64url ENCRYPTION_KEY；省略时持久化生成的密钥。",
    )
    parser.add_argument(
        "--nginx-mode",
        choices=NGINX_MODES,
        default="auto",
        help="Nginx 管理模式：auto 仅检测系统级 Nginx，system 强制系统级模式，docker 使用指定官方 Docker Nginx 容器。",
    )
    parser.add_argument(
        "--nginx-container",
        help="Docker Nginx 模式的官方 Nginx 容器名；提供后自动选择 docker 模式，不会扫描其他容器。",
    )
    parser.add_argument("--version", action="version", version="SlothVault 部署脚本 {0}".format(__version__))
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    arguments = parse_arguments(argv)
    try:
        resolved_nginx_mode(arguments)
        action = prompt_action(arguments.action)
        root_value = arguments.root
        if root_value is None and action == "install":
            root_value = prompt_value("部署根目录", str(DEFAULT_ROOT))
        root = normalize_path(root_value or str(DEFAULT_ROOT), "部署根目录")
        check_docker()
        if action == "install":
            install(arguments, root)
        elif action == "nginx":
            configure_existing_nginx(arguments, root)
        elif action == "https":
            configure_https(arguments, root)
        elif action == "renew":
            certificate_status_or_renew(arguments, root)
        else:
            operate_existing(action, root)
        return 0
    except (InstallerError, OSError) as error:
        print_error(str(error))
        return 1
    except KeyboardInterrupt:
        print_error("操作已中断，未删除已有部署数据")
        return 130
