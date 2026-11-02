#!/usr/bin/env python3
"""
@file integrations/deployment/restart.py
@project SlothVault
@module Standalone deployment
@description 仅重启 SlothVault 应用，保留数据库运行状态。
@logic Operate only the selected managed Compose deployment; retain configuration and persistent data.
@dependencies Python standard library, shared deployment tools
@index_tags deployment,standalone,compose
@author holic512
"""

from __future__ import annotations

import sys
from slothvault_deploy.cli import argument_parser, execute
from slothvault_deploy.compose import COMPOSE_FILE_NAME, compose_command, require_managed_compose
from slothvault_deploy.system import run_command


def restart(arguments):
    compose_path = arguments.root / COMPOSE_FILE_NAME
    require_managed_compose(compose_path)
    run_command(compose_command(compose_path, 'restart', 'slothvault'))
    run_command(compose_command(compose_path, 'ps'))


def main(argv=None) -> int:
    return execute(argument_parser('仅重启 SlothVault 应用，保留数据库运行状态。'), restart, argv)


if __name__ == "__main__":
    sys.exit(main())
