#!/usr/bin/env python3
"""
@file integrations/deployment/update.py
@project SlothVault
@module Standalone deployment
@description Updates one managed application to an immutable official Release.
@logic Preview and confirm once, pull before activation, then verify the running version and health.
@dependencies Python standard library, shared deployment tools
@index_tags deployment,standalone,compose
@author holic512
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

from slothvault_deploy.cli import argument_parser, execute
from slothvault_deploy.compose import COMPOSE_FILE_NAME, compose_command, pin_managed_application_image
from slothvault_deploy.release import check_deployment_update, print_update_check, release_image_reference, verify_application
from slothvault_deploy.system import InstallerError, print_info, prompt_yes_no, run_command, write_text_atomically


def update_managed_application(root: Path) -> dict[str, object]:
    """Review one immutable target, pull before activation, and verify the actual running application."""
    initial = check_deployment_update(root)
    print_update_check(initial)
    compose_path = root / COMPOSE_FILE_NAME
    target_release = initial.next_application_release
    outcome = {"currentVersion": initial.application_tag, "beforeVersion": initial.application_tag, "verified": False}
    if initial.error:
        raise InstallerError("无法检查应用更新：{0}。当前运行版本未改变。".format(initial.error))
    if target_release is not None:
        if not initial.application_image:
            raise InstallerError("无法读取当前应用镜像，无法安全执行更新。")
        target_image = release_image_reference(initial.application_image, target_release.tag)
        outcome["targetVersion"] = target_release.tag
        if not prompt_yes_no("确认拉取 {0} 并重启受管应用".format(target_release.tag), default=False):
            print_info("已取消更新，未拉取镜像或重启容器。")
            return {**outcome, "outcome": "cancelled"}
    elif initial.status in ("UP_TO_DATE", "LOCAL_NEWER"):
        print_info("当前应用版本高于最新正式版本，不拉取镜像或重启容器。" if initial.status == "LOCAL_NEWER" else "当前应用已是最新正式版本，不拉取镜像或重启容器。")
        return {**outcome, "outcome": "unchanged", "verified": True}
    else:
        print_info("当前版本无法安全确定最新更新目标；不会拉取 latest 镜像或重启容器。")
        raise InstallerError("当前应用版本无法安全确定更新目标，请先检查实际运行版本和正式 Release。")

    original = compose_path.read_text(encoding="utf-8")
    mode = compose_path.stat().st_mode & 0o777
    descriptor, name = tempfile.mkstemp(prefix=".slothvault-update-", suffix=".yml", dir=root)
    staged = Path(name)
    recreating = False
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(original)
        pin_managed_application_image(staged, target_image)
        run_command(("docker", "compose", "--project-directory", str(root), "-f", str(staged), "pull", "slothvault"))
        pin_managed_application_image(compose_path, target_image)
        recreating = True
        run_command(compose_command(compose_path, "up", "-d", "slothvault"))
        verified = verify_application(compose_path, target_release.tag, target_image)
    except BaseException:
        if not recreating and compose_path.read_text(encoding="utf-8") != original:
            write_text_atomically(compose_path, original, mode)
        raise
    finally:
        staged.unlink(missing_ok=True)
    if verified["health"] == "not-configured":
        print_info("应用未配置健康检查；运行版本与镜像已核验。")
    print_info("已更新并确认运行中的应用达到 {0}；持久化数据已保留。".format(target_release.tag))
    return {**outcome, **verified, "outcome": "updated"}


def main(argv=None) -> int:
    return execute(argument_parser("更新现有 SlothVault 应用。"), lambda args: update_managed_application(args.root), argv)


if __name__ == "__main__":
    sys.exit(main())
