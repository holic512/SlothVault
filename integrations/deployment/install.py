#!/usr/bin/env python3
"""
@file integrations/deployment/install.py
@project SlothVault
@module Standalone deployment
@description Installs a new private Docker Compose instance.
@logic Collect database and storage settings, confirm before writes, then pull and start the instance.
@dependencies Python standard library, shared deployment tools
@index_tags deployment,standalone,compose
@author holic512
"""

from __future__ import annotations

import sys
from slothvault_deploy.cli import argument_parser, execute
from slothvault_deploy.compose import PROVIDERS, compose_command, configure_installation, write_private_compose
from slothvault_deploy.system import print_info, prompt_confirm, run_command


def install(arguments):
    config = configure_installation(arguments, arguments.root)
    print("\n部署配置确认：")
    print(f"  数据库类型：{config.provider}")
    print(f"  Compose 文件：{config.compose_path}")
    print(f"  应用数据目录：{config.data_dir}")
    if config.database_dir:
        print(f"  数据库存储目录：{config.database_dir}")
    print(f"  HTTP 端口：{config.port}")
    print(f"  Docker 镜像：{config.image}")
    prompt_confirm("确认创建该新部署")
    write_private_compose(config)
    print_info(f"已生成 {config.compose_path}，文件权限为 0600")
    run_command(compose_command(config.compose_path, "pull"))
    run_command(compose_command(config.compose_path, "up", "-d"))
    run_command(compose_command(config.compose_path, "ps"))
    print_info(f"首次启动时自动初始化数据库；请访问 http://<服务器地址>:{config.port}/install 创建首位管理员。")


def main(argv=None) -> int:
    parser = argument_parser("安装新的 SlothVault Docker Compose 实例。")
    parser.add_argument("--provider", choices=PROVIDERS, help="数据库类型。")
    parser.add_argument("--data-dir", help="应用持久化数据目录。")
    parser.add_argument("--database-dir", help="MySQL 或 PostgreSQL 数据目录。")
    parser.add_argument("--image", help="Docker 镜像，默认 holic512/slothvault:latest。")
    parser.add_argument("--port", help="宿主机 HTTP 端口，默认 3000。")
    parser.add_argument("--encryption-key", help="可选的 43 字符 base64url ENCRYPTION_KEY。")
    return execute(parser, install, argv)


if __name__ == "__main__":
    sys.exit(main())
