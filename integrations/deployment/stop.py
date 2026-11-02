#!/usr/bin/env python3
"""
@file integrations/deployment/stop.py
@project SlothVault
@module Standalone deployment
@description 停止现有实例，保留持久化数据。
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


def stop(arguments):
    compose_path = arguments.root / COMPOSE_FILE_NAME
    require_managed_compose(compose_path)
    run_command(compose_command(compose_path, 'stop'))


def main(argv=None) -> int:
    return execute(argument_parser('停止现有实例，保留持久化数据。'), stop, argv)


if __name__ == "__main__":
    sys.exit(main())
