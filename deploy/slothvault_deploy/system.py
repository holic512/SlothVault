"""
@file deploy/slothvault_deploy/system.py
@project SlothVault
@module Deployment system utilities
@description Provides safe host command execution, prompts, path validation and atomic file writes for the release deployment package.
@logic Validate user-controlled values before they reach host commands or configuration files, then perform recoverable atomic writes and display Chinese diagnostics.
@dependencies Python standard library
@index_tags deployment,installer,system,security,filesystem,subprocess
@author holic512
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable, Optional, Sequence


VALID_IMAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/@:-]*$")


class InstallerError(RuntimeError):
    """Represents a safe-to-display deployment setup error."""


def print_info(message: str) -> None:
    print("[SlothVault] {0}".format(message))


def print_error(message: str) -> None:
    print("[SlothVault] 错误：{0}".format(message), file=sys.stderr)


def normalize_path(value: str, label: str) -> Path:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        raise InstallerError("{0}必须使用绝对路径：{1}".format(label, value))
    path = candidate.resolve(strict=False)
    if path == Path("/"):
        raise InstallerError("{0}不能使用文件系统根目录".format(label))
    if "\x00" in str(path):
        raise InstallerError("{0}包含无效的 NUL 字符".format(label))
    return path


def path_is_within(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
    except ValueError:
        return False
    return True


def validate_port(value: str) -> int:
    if not value.isdigit():
        raise InstallerError("端口必须是 1 到 65535 之间的整数")
    port = int(value)
    if port < 1 or port > 65535:
        raise InstallerError("端口必须是 1 到 65535 之间的整数")
    return port


def validate_image(value: str) -> str:
    image = value.strip()
    if not VALID_IMAGE.fullmatch(image):
        raise InstallerError("Docker 镜像名不能包含空白或不支持的字符")
    return image


def yaml_string(value: object) -> str:
    """Return a Compose-safe YAML string, preserving literal dollar signs."""

    text = str(value)
    if "\x00" in text or "\n" in text or "\r" in text:
        raise InstallerError("写入 Compose 的值不能包含控制字符")
    return json.dumps(text.replace("$", "$$"), ensure_ascii=False)


def quote_lines(items: Sequence[tuple[str, object]], indent: int = 6) -> list[str]:
    prefix = " " * indent
    return ["{0}{1}: {2}".format(prefix, key, yaml_string(value)) for key, value in items]


def prompt_value(
    label: str,
    default: str,
    validator: Optional[Callable[[str], str]] = None,
) -> str:
    while True:
        try:
            value = input("{0} [{1}]: ".format(label, default)).strip() or default
        except EOFError as error:
            raise InstallerError("安装配置尚未完成，输入已结束") from error
        try:
            return validator(value) if validator else value
        except InstallerError as error:
            print_error(str(error))


def prompt_yes_no(message: str, default: bool = False) -> bool:
    suffix = "[Y/n]" if default else "[y/N]"
    while True:
        try:
            value = input("{0} {1}：".format(message, suffix)).strip().lower()
        except EOFError as error:
            raise InstallerError("尚未确认，输入已结束") from error
        if not value:
            return default
        if value in ("y", "yes", "是", "确认"):
            return True
        if value in ("n", "no", "否"):
            return False
        print_error("请输入 y 或 n")


def prompt_confirm(message: str) -> None:
    if not prompt_yes_no(message):
        raise InstallerError("已取消操作，未写入任何文件")


def require_root(action: str) -> None:
    if os.geteuid() != 0:
        raise InstallerError("{0}需要写入系统配置；请使用 sudo python3 deploy/install.py 重新运行".format(action))


def ensure_fresh_directory(path: Path, label: str) -> None:
    if path.exists() and not path.is_dir():
        raise InstallerError("{0}不是目录：{1}".format(label, path))
    if path.exists() and any(path.iterdir()):
        raise InstallerError(
            "{0}不是空目录：{1}。为保护已有数据，脚本拒绝复用或覆盖。".format(label, path)
        )


def create_private_directory(path: Path, secure_existing: bool = True) -> None:
    existed = path.exists()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if secure_existing or not existed:
        os.chmod(str(path), 0o700)


def write_text_atomically(path: Path, source: str, mode: int) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".{0}.".format(path.name), suffix=".tmp", dir=str(path.parent), text=True
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as temporary_file:
            temporary_file.write(source)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.chmod(str(temporary_path), mode)
        os.replace(str(temporary_path), str(path))
        os.chmod(str(path), mode)
    except OSError:
        try:
            temporary_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def read_text_file(path: Path, label: str) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as error:
        raise InstallerError("无法读取{0}：{1}".format(label, path)) from error


def run_command(command: Sequence[str], quiet: bool = False) -> None:
    if not quiet:
        print_info("执行命令：{0}".format(" ".join(command)))
    try:
        subprocess.run(
            list(command),
            check=True,
            stdout=subprocess.DEVNULL if quiet else None,
            stderr=subprocess.DEVNULL if quiet else None,
        )
    except FileNotFoundError as error:
        raise InstallerError("未找到命令：{0}".format(command[0])) from error
    except subprocess.CalledProcessError as error:
        raise InstallerError(
            "命令执行失败（退出码 {0}）：{1}".format(error.returncode, " ".join(command))
        ) from error


def command_succeeds(command: Sequence[str]) -> bool:
    try:
        return subprocess.run(
            list(command),
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode == 0
    except OSError:
        return False


def check_docker() -> None:
    if shutil.which("docker") is None:
        raise InstallerError("运行脚本前必须先安装 Docker Engine 和 Docker Compose v2")
    run_command(("docker", "compose", "version"))


def read_os_release() -> dict[str, str]:
    path = Path("/etc/os-release")
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value.strip().strip('"').strip("'")
    return values
