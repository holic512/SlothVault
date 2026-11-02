#!/usr/bin/env python3
"""
@file integrations/deployment/menu.py
@project SlothVault
@module Standalone deployment
@description Provides a small Chinese terminal menu for the standalone deployment scripts.
@logic Keep the chosen root across operations and delegate to the same entrypoints used by direct CLI calls.
@dependencies Python standard library, shared deployment tools
@index_tags deployment,standalone,compose
@author holic512
"""

from __future__ import annotations

import sys
import importlib
from argparse import ArgumentTypeError
from slothvault_deploy.cli import argument_parser, root_argument
from slothvault_deploy.system import print_error

OPERATIONS = (
    ("安装新实例", "install"), ("检查应用更新", "check_update"),
    ("更新应用", "update"), ("启动实例", "start"),
    ("停止实例", "stop"), ("仅重启应用", "restart"), ("查看状态", "status"),
)


def main(argv=None) -> int:
    try:
        arguments = argument_parser("SlothVault 独立部署菜单。").parse_args(argv)
        root = arguments.root
        while True:
            print(f"\nSlothVault 部署管理\n当前部署目录：{root}")
            for index, (label, _) in enumerate(OPERATIONS, 1):
                print(f"  {index}) {label}")
            print("  8) 修改部署目录\n  0) 退出")
            selected = input("请选择操作：").strip()
            if selected in ("0", "q", "Q"):
                return 0
            if selected == "8":
                value = input(f"部署目录 [{root}]：").strip()
                if value:
                    try:
                        root = root_argument(value)
                    except ArgumentTypeError as error:
                        print_error(str(error))
                continue
            if selected not in tuple(str(i) for i in range(1, len(OPERATIONS) + 1)):
                print_error("请输入菜单中的数字，0 退出。")
                continue
            label, module = OPERATIONS[int(selected) - 1]
            code = importlib.import_module(module).main(["--root", str(root)])
            if code == 130:
                return code
            print(f"{label}：{'完成' if code == 0 else '未完成'}（退出码 {code}）")
    except SystemExit as error:
        return int(error.code or 0)
    except EOFError:
        return 0
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
