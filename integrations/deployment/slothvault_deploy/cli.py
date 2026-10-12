"""
@file integrations/deployment/slothvault_deploy/cli.py
@project SlothVault
@module Deployment command-line interface
@description Parses legacy deployment arguments and delegates operations to the shared deployment service.
@logic Preserve the existing Python CLI contract while routing actions through the service layer.
@dependencies Python standard library, deployment_service
@index_tags deployment,cli,arguments
@author holic512
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Optional, Sequence

from .compose import DEFAULT_ROOT, PROVIDERS
from .deployment_service import (
    ACTIONS, NGINX_MODES, certificate_status_or_renew, check_deployment_update,
    configure_existing_nginx, configure_https, install, operate_existing,
    print_update_check, prompt_action, resolved_nginx_mode, update_managed_application,
)
from .system import InstallerError, check_docker, normalize_path, print_error, prompt_value
from . import __version__
from .nginx_management import show_nginx, update_nginx, configure_nginx


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
        help="Nginx 管理模式：auto 发现本机和 Docker，system 仅本机，docker 仅 Docker。",
    )
    parser.add_argument(
        "--nginx-container",
        help="可选 Docker Nginx 容器名；省略时发现候选容器。",
    )
    parser.add_argument("--nginx-config", help="选定实例的主配置绝对路径（Docker 模式为容器内路径）。")
    parser.add_argument("--nginx-site", help="选定站点的生效配置路径或宿主机挂载路径。")
    parser.add_argument("--nginx-server-name", help="用于选定 server 块的站点域名。")
    parser.add_argument("--version", action="version", version="SlothVault Deployment Package {0}".format(__version__))
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
        if arguments.nginx_config and not Path(arguments.nginx_config).is_absolute():
            raise InstallerError("Nginx 主配置必须使用绝对路径")
        if action not in ("nginx-discover", "nginx-status", "nginx-update", "nginx"):
            check_docker()
        if action == "install":
            install(arguments, root)
        elif action == "nginx":
            configure_nginx(arguments, root)
        elif action in ("nginx-discover", "nginx-status"):
            show_nginx(arguments, root)
        elif action == "nginx-update":
            update_nginx(arguments, root)
        elif action == "https":
            configure_https(arguments, root)
        elif action == "renew":
            certificate_status_or_renew(arguments, root)
        elif action == "check-update":
            print_update_check(check_deployment_update(root))
        elif action == "update":
            update_managed_application(root)
        else:
            operate_existing(action, root)
        return 0
    except (InstallerError, OSError) as error:
        print_error(str(error))
        return 1
    except KeyboardInterrupt:
        print_error("操作已中断，未删除已有部署数据")
        return 130
