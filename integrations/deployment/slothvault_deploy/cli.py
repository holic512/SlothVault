#!/usr/bin/env python3
"""
@file integrations/deployment/slothvault_deploy/cli.py
@project SlothVault
@module Standalone deployment
@description Shares argument parsing and exit handling for independent operation scripts.
@logic Validate the root once at the CLI boundary and execute an operation with normal terminal output.
@dependencies Python standard library, shared deployment tools
@index_tags deployment,standalone,compose
@author holic512
"""

from __future__ import annotations

import argparse
from . import __version__
from .compose import DEFAULT_ROOT
from .system import InstallerError, check_docker, normalize_path, print_error


def argument_parser(description):
    parser = argparse.ArgumentParser(description=description, allow_abbrev=False)
    parser.add_argument("--root", default=str(DEFAULT_ROOT), type=root_argument, help="部署根目录，默认 /data/slothvault。")
    parser.add_argument("--version", action="version", version=f"SlothVault Deployment Package {__version__}")
    return parser


def execute(parser, operation, argv=None) -> int:
    try:
        arguments = parser.parse_args(argv)
        check_docker()
        operation(arguments)
        return 0
    except SystemExit as error:
        return int(error.code or 0)
    except (InstallerError, OSError) as error:
        print_error(str(error))
        return 1
    except KeyboardInterrupt:
        print_error("操作已中断，未删除已有部署数据")
        return 130


def root_argument(value):
    try:
        return normalize_path(value, "部署根目录")
    except (InstallerError, OSError, ValueError) as error:
        raise argparse.ArgumentTypeError(str(error)) from error
