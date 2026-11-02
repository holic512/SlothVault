#!/usr/bin/env python3
"""
@file integrations/deployment/check_update.py
@project SlothVault
@module Standalone deployment
@description Checks the running application against official Releases.
@logic Inspect only the managed application and show available versions and release history without writes.
@dependencies Python standard library, shared deployment tools
@index_tags deployment,standalone,compose
@author holic512
"""

from __future__ import annotations

import sys
from slothvault_deploy.cli import argument_parser, execute
from slothvault_deploy.release import check_deployment_update, print_update_check
from slothvault_deploy.system import InstallerError


def check_update(arguments):
    result = check_deployment_update(arguments.root)
    print_update_check(result)
    if result.error:
        raise InstallerError(f"更新检查失败：{result.error}")


def main(argv=None) -> int:
    return execute(argument_parser("检查 SlothVault 应用更新。"), check_update, argv)


if __name__ == "__main__":
    sys.exit(main())
