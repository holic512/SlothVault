#!/usr/bin/env python3
"""
@file install.py
@project SlothVault
@module Host Deployment Installer
@description Generates and operates one self-contained Docker Compose deployment from a Linux host without third-party Python packages.
@logic Collect a provider-specific, fresh persistent-storage layout, write a private generated Compose file atomically, and delegate image lifecycle actions to Docker Compose without altering existing deployment data.
@dependencies Python standard library, Docker Engine, Docker Compose v2, published SlothVault Docker image
@index_tags docker,compose,installer,sqlite,mysql,postgresql,persistence,release
@author holic512
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence


SCRIPT_VERSION = "1.0.0"
DEFAULT_ROOT = Path("/data/slothvault")
DEFAULT_IMAGE = "holic512/slothvault:latest"
COMPOSE_FILE_NAME = "compose.yml"
MANAGED_COMPOSE_MARKER = "# Managed by SlothVault install.py"
VALID_ENCRYPTION_KEY = re.compile(r"^[A-Za-z0-9_-]{43}$")
VALID_IMAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/@:-]*$")
PROVIDERS = ("sqlite", "mysql", "postgresql")
ACTIONS = ("install", "update", "start", "stop", "status")


class InstallerError(RuntimeError):
    """Represents a safe-to-display deployment setup error."""


@dataclass(frozen=True)
class DeploymentConfig:
    """The values embedded into one generated Compose deployment."""

    root: Path
    data_dir: Path
    provider: str
    image: str
    port: int
    database_dir: Optional[Path] = None
    encryption_key: Optional[str] = None
    database_name: Optional[str] = None
    database_user: Optional[str] = None
    database_password: Optional[str] = None
    database_root_password: Optional[str] = None

    @property
    def compose_path(self) -> Path:
        return self.root / COMPOSE_FILE_NAME


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
        raise InstallerError("{0}不能使用文件系统根目录")
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


def prompt_value(label: str, default: str, validator=None) -> str:
    while True:
        try:
            value = input("{0} [{1}]: ".format(label, default)).strip() or default
        except EOFError as error:
            raise InstallerError("安装配置尚未完成，输入已结束") from error
        try:
            return validator(value) if validator else value
        except InstallerError as error:
            print_error(str(error))


def prompt_provider(default: Optional[str] = None) -> str:
    if default:
        return default
    choices = {"1": "sqlite", "2": "mysql", "3": "postgresql"}
    print("\n请选择数据库类型：")
    print("  1) SQLite（单机本地存储）")
    print("  2) MySQL 8.0")
    print("  3) PostgreSQL 16")
    while True:
        try:
            selected = input("数据库类型 [1]: ").strip() or "1"
        except EOFError as error:
            raise InstallerError("尚未选择数据库类型，输入已结束") from error
        provider = choices.get(selected)
        if provider:
            return provider
        print_error("请输入 1、2 或 3")


def prompt_action(default: Optional[str] = None) -> str:
    if default:
        return default
    choices = {
        "1": "install",
        "2": "update",
        "3": "start",
        "4": "stop",
        "5": "status",
    }
    print("\n请选择操作：")
    print("  1) 安装新实例并生成 compose.yml")
    print("  2) 拉取最新镜像并更新现有实例")
    print("  3) 启动现有实例")
    print("  4) 停止现有实例（保留持久化数据）")
    print("  5) 查看现有实例状态")
    while True:
        try:
            selected = input("操作 [1]: ").strip() or "1"
        except EOFError as error:
            raise InstallerError("尚未选择操作，输入已结束") from error
        action = choices.get(selected)
        if action:
            return action
        print_error("请输入 1 到 5 的数字")


def prompt_optional_encryption_key(value: Optional[str]) -> Optional[str]:
    if value is not None:
        key = value.strip()
        if not VALID_ENCRYPTION_KEY.fullmatch(key):
            raise InstallerError("ENCRYPTION_KEY 必须是 43 个字符的 base64url 值")
        return key

    try:
        key = getpass.getpass(
            "可选 ENCRYPTION_KEY（留空时将在 data/config 中持久化生成密钥）："
        ).strip()
    except (EOFError, getpass.GetPassWarning) as error:
        raise InstallerError("无法安全读取 ENCRYPTION_KEY") from error
    if not key:
        return None
    if not VALID_ENCRYPTION_KEY.fullmatch(key):
        raise InstallerError("ENCRYPTION_KEY 必须是 43 个字符的 base64url 值")
    return key


def prompt_password(label: str) -> str:
    try:
        value = getpass.getpass(
            "{0}（留空则自动生成，并且仅写入 compose.yml）：".format(label)
        )
    except (EOFError, getpass.GetPassWarning) as error:
        raise InstallerError("无法安全读取{0}".format(label)) from error
    if value:
        return value
    return secrets.token_urlsafe(32)


def prompt_confirm(message: str) -> None:
    try:
        confirmed = input("{0} [y/N]：".format(message)).strip().lower()
    except EOFError as error:
        raise InstallerError("尚未确认，输入已结束") from error
    if confirmed not in ("y", "yes", "是", "确认"):
        raise InstallerError("已取消安装，未写入任何文件")


def ensure_fresh_directory(path: Path, label: str) -> None:
    if path.exists() and not path.is_dir():
        raise InstallerError("{0}不是目录：{1}".format(label, path))
    if path.exists() and any(path.iterdir()):
        raise InstallerError(
            "{0}不是空目录：{1}。为保护已有数据，脚本拒绝复用或覆盖。".format(
                label, path
            )
        )


def create_private_directory(path: Path, secure_existing: bool = True) -> None:
    existed = path.exists()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if secure_existing or not existed:
        os.chmod(str(path), 0o700)


def run_command(command: Sequence[str]) -> None:
    print_info("执行命令：{0}".format(" ".join(command)))
    try:
        subprocess.run(list(command), check=True)
    except FileNotFoundError as error:
        raise InstallerError("未安装 Docker，或 Docker 不在 PATH 中") from error
    except subprocess.CalledProcessError as error:
        raise InstallerError(
            "命令执行失败（退出码 {0}）：{1}".format(error.returncode, " ".join(command))
        ) from error


def check_docker() -> None:
    if shutil.which("docker") is None:
        raise InstallerError("运行脚本前必须先安装 Docker Engine 和 Docker Compose v2")
    run_command(("docker", "compose", "version"))


def require_managed_compose(compose_path: Path) -> None:
    if not compose_path.is_file():
        raise InstallerError("未找到脚本生成的 Compose 文件：{0}".format(compose_path))
    try:
        source = compose_path.read_text(encoding="utf-8")
    except OSError as error:
        raise InstallerError("无法读取脚本生成的 Compose 文件：{0}".format(compose_path)) from error
    if MANAGED_COMPOSE_MARKER not in source:
        raise InstallerError(
            "为保护现有部署，脚本拒绝操作不是由它生成的 Compose 文件：{0}".format(compose_path)
        )


def database_default(root: Path, provider: str) -> Optional[Path]:
    if provider == "mysql":
        return root / "mysql"
    if provider == "postgresql":
        return root / "postgresql"
    return None


def configure_installation(arguments: argparse.Namespace, root: Path) -> DeploymentConfig:
    provider = prompt_provider(arguments.provider)
    data_default = root / "data"
    data_dir = normalize_path(
        arguments.data_dir or prompt_value("应用持久化数据目录", str(data_default)),
        "应用持久化数据目录",
    )
    database_dir = None
    if provider != "sqlite":
        default_directory = database_default(root, provider)
        assert default_directory is not None
        database_dir = normalize_path(
            arguments.database_dir
            or prompt_value("{0} 数据库存储目录".format(provider.title()), str(default_directory)),
            "数据库存储目录",
        )
        if path_is_within(database_dir, data_dir) or path_is_within(data_dir, database_dir):
            raise InstallerError(
                "应用数据目录不能与 {0} 数据库存储目录重叠".format(provider)
            )

    port_value = str(arguments.port) if arguments.port is not None else prompt_value("HTTP 端口", "3000")
    port = validate_port(port_value)
    image = validate_image(arguments.image or prompt_value("SlothVault Docker 镜像", DEFAULT_IMAGE))
    encryption_key = prompt_optional_encryption_key(arguments.encryption_key)

    database_name = None
    database_user = None
    database_password = None
    database_root_password = None
    if provider == "mysql":
        database_name = prompt_value("MySQL 数据库名", "slothvault")
        database_user = prompt_value("MySQL 应用用户名", "slothvault")
        database_password = prompt_password("MySQL 应用密码")
        database_root_password = prompt_password("MySQL root 密码")
    elif provider == "postgresql":
        database_name = prompt_value("PostgreSQL 数据库名", "slothvault")
        database_user = prompt_value("PostgreSQL 应用用户名", "slothvault")
        database_password = prompt_password("PostgreSQL 应用密码")

    return DeploymentConfig(
        root=root,
        data_dir=data_dir,
        provider=provider,
        image=image,
        port=port,
        database_dir=database_dir,
        encryption_key=encryption_key,
        database_name=database_name,
        database_user=database_user,
        database_password=database_password,
        database_root_password=database_root_password,
    )


def render_common_application(config: DeploymentConfig) -> list[str]:
    environment = [
        ("APP_DATA_PATH", "/app/data"),
        ("UPLOAD_STORAGE_PATH", "/app/data/uploads"),
    ]
    if config.encryption_key:
        environment.append(("ENCRYPTION_KEY", config.encryption_key))
    environment.extend(
        [
            ("SLOTHVAULT_AUTO_BOOTSTRAP", "1"),
            ("SLOTHVAULT_BOOTSTRAP_PROVIDER", config.provider),
        ]
    )
    lines = [
        "  slothvault:",
        "    image: {0}".format(yaml_string(config.image)),
        "    restart: unless-stopped",
        "    ports:",
        "      - {0}".format(yaml_string("{0}:3000".format(config.port))),
        "    volumes:",
        "      - {0}".format(yaml_string("{0}:/app/data".format(config.data_dir))),
        "    environment:",
    ]
    lines.extend(quote_lines(environment))
    return lines


def render_sqlite_compose(config: DeploymentConfig) -> str:
    lines = [
        MANAGED_COMPOSE_MARKER,
        "# Provider: sqlite",
        "# Persistent application data: {0}".format(config.data_dir),
        "name: slothvault-sqlite",
        "",
        "services:",
    ]
    lines.extend(render_common_application(config))
    return "\n".join(lines) + "\n"


def render_mysql_compose(config: DeploymentConfig) -> str:
    assert config.database_dir is not None
    assert config.database_name is not None
    assert config.database_user is not None
    assert config.database_password is not None
    assert config.database_root_password is not None
    lines = [
        MANAGED_COMPOSE_MARKER,
        "# Provider: mysql",
        "# Persistent application data: {0}".format(config.data_dir),
        "# Persistent MySQL data: {0}".format(config.database_dir),
        "name: slothvault-mysql",
        "",
        "services:",
    ]
    application = render_common_application(config)
    application.extend(
        quote_lines(
            [
                ("SLOTHVAULT_BOOTSTRAP_HOST", "mysql"),
                ("SLOTHVAULT_BOOTSTRAP_PORT", "3306"),
                ("SLOTHVAULT_BOOTSTRAP_DATABASE", config.database_name),
                ("SLOTHVAULT_BOOTSTRAP_USERNAME", config.database_user),
                ("SLOTHVAULT_BOOTSTRAP_PASSWORD", config.database_password),
                ("SLOTHVAULT_BOOTSTRAP_TLS_ENABLED", "false"),
            ]
        )
    )
    application.extend(
        [
            "    depends_on:",
            "      mysql:",
            "        condition: service_healthy",
        ]
    )
    lines.extend(application)
    lines.extend(
        [
            "",
            "  mysql:",
            "    image: mysql:8.0",
            "    restart: unless-stopped",
            "    command:",
            "      - --character-set-server=utf8mb4",
            "      - --collation-server=utf8mb4_unicode_ci",
            "    environment:",
        ]
    )
    lines.extend(
        quote_lines(
            [
                ("MYSQL_DATABASE", config.database_name),
                ("MYSQL_USER", config.database_user),
                ("MYSQL_PASSWORD", config.database_password),
                ("MYSQL_ROOT_PASSWORD", config.database_root_password),
            ]
        )
    )
    lines.extend(
        [
            "    volumes:",
            "      - {0}".format(
                yaml_string("{0}:/var/lib/mysql".format(config.database_dir))
            ),
            "    healthcheck:",
            "      test: [\"CMD-SHELL\", \"mysqladmin ping -h 127.0.0.1 -u root -p$${MYSQL_ROOT_PASSWORD} --silent\"]",
            "      interval: 10s",
            "      timeout: 5s",
            "      retries: 15",
            "      start_period: 20s",
        ]
    )
    return "\n".join(lines) + "\n"


def render_postgresql_compose(config: DeploymentConfig) -> str:
    assert config.database_dir is not None
    assert config.database_name is not None
    assert config.database_user is not None
    assert config.database_password is not None
    lines = [
        MANAGED_COMPOSE_MARKER,
        "# Provider: postgresql",
        "# Persistent application data: {0}".format(config.data_dir),
        "# Persistent PostgreSQL data: {0}".format(config.database_dir),
        "name: slothvault-postgresql",
        "",
        "services:",
    ]
    application = render_common_application(config)
    application.extend(
        quote_lines(
            [
                ("SLOTHVAULT_BOOTSTRAP_HOST", "postgresql"),
                ("SLOTHVAULT_BOOTSTRAP_PORT", "5432"),
                ("SLOTHVAULT_BOOTSTRAP_DATABASE", config.database_name),
                ("SLOTHVAULT_BOOTSTRAP_USERNAME", config.database_user),
                ("SLOTHVAULT_BOOTSTRAP_PASSWORD", config.database_password),
                ("SLOTHVAULT_BOOTSTRAP_TLS_ENABLED", "false"),
            ]
        )
    )
    application.extend(
        [
            "    depends_on:",
            "      postgresql:",
            "        condition: service_healthy",
        ]
    )
    lines.extend(application)
    lines.extend(
        [
            "",
            "  postgresql:",
            "    image: postgres:16-alpine",
            "    restart: unless-stopped",
            "    environment:",
        ]
    )
    lines.extend(
        quote_lines(
            [
                ("POSTGRES_DB", config.database_name),
                ("POSTGRES_USER", config.database_user),
                ("POSTGRES_PASSWORD", config.database_password),
            ]
        )
    )
    lines.extend(
        [
            "    volumes:",
            "      - {0}".format(
                yaml_string("{0}:/var/lib/postgresql/data".format(config.database_dir))
            ),
            "    healthcheck:",
            "      test: [\"CMD-SHELL\", \"pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}\"]",
            "      interval: 10s",
            "      timeout: 5s",
            "      retries: 10",
            "      start_period: 10s",
        ]
    )
    return "\n".join(lines) + "\n"


def render_compose(config: DeploymentConfig) -> str:
    if config.provider == "sqlite":
        return render_sqlite_compose(config)
    if config.provider == "mysql":
        return render_mysql_compose(config)
    if config.provider == "postgresql":
        return render_postgresql_compose(config)
    raise InstallerError("不支持的数据库类型：{0}".format(config.provider))


def write_private_compose(config: DeploymentConfig) -> None:
    if os.path.lexists(str(config.compose_path)):
        raise InstallerError(
            "Compose 文件已存在：{0}。请使用“更新”操作；安装脚本不会覆盖已有部署。".format(
                config.compose_path
            )
        )
    ensure_fresh_directory(config.data_dir, "应用持久化数据目录")
    if config.database_dir:
        ensure_fresh_directory(config.database_dir, "数据库持久化数据目录")

    create_private_directory(config.root, secure_existing=False)
    create_private_directory(config.data_dir)
    if config.database_dir:
        create_private_directory(config.database_dir)

    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".compose.", suffix=".tmp", dir=str(config.root), text=True
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as temporary_file:
            temporary_file.write(render_compose(config))
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.chmod(str(temporary_path), 0o600)
        os.replace(str(temporary_path), str(config.compose_path))
        os.chmod(str(config.compose_path), 0o600)
    except OSError as error:
        try:
            temporary_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise InstallerError("无法写入生成的 Compose 文件：{0}".format(error)) from error


def compose_command(compose_path: Path, *arguments: str) -> tuple[str, ...]:
    return ("docker", "compose", "-f", str(compose_path), *arguments)


def install(arguments: argparse.Namespace, root: Path) -> None:
    config = configure_installation(arguments, root)
    print("\n部署配置确认：")
    print("  数据库类型：{0}".format(config.provider))
    print("  Compose 文件：{0}".format(config.compose_path))
    print("  应用数据目录：{0}".format(config.data_dir))
    if config.database_dir:
        print("  数据库存储目录：{0}".format(config.database_dir))
    print("  HTTP 端口：{0}".format(config.port))
    print("  Docker 镜像：{0}".format(config.image))
    prompt_confirm("确认创建该新部署")
    write_private_compose(config)
    print_info("已生成 {0}，文件权限为 0600".format(config.compose_path))
    run_command(compose_command(config.compose_path, "pull"))
    run_command(compose_command(config.compose_path, "up", "-d"))
    run_command(compose_command(config.compose_path, "ps"))
    print_info("首次启动时会自动初始化数据库 schema。")
    print_info(
        "slothvault 服务启动后，请访问 http://<服务器地址>:{0}/install 创建首位管理员。".format(
            config.port
        )
    )


def operate_existing(action: str, root: Path) -> None:
    compose_path = root / COMPOSE_FILE_NAME
    require_managed_compose(compose_path)
    commands = {
        "update": (("pull",), ("up", "-d"), ("ps",)),
        "start": (("up", "-d"), ("ps",)),
        "stop": (("stop",),),
        "status": (("ps",),),
    }
    for command in commands[action]:
        run_command(compose_command(compose_path, *command))
    if action == "update":
        print_info("已更新 {0} 中声明的镜像，持久化数据已保留。".format(compose_path))


def parse_arguments(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="生成并管理独立的 SlothVault Docker Compose 部署。"
    )
    parser.add_argument(
        "--action",
        choices=ACTIONS,
        help="跳过交互式操作选择。",
    )
    parser.add_argument(
        "--root",
        help="部署根目录，默认 /data/slothvault。",
    )
    parser.add_argument(
        "--provider",
        choices=PROVIDERS,
        help="新安装时跳过数据库类型选择。",
    )
    parser.add_argument("--data-dir", help="应用持久化数据目录。")
    parser.add_argument(
        "--database-dir",
        help="MySQL 或 PostgreSQL 数据库持久化目录。",
    )
    parser.add_argument("--image", help="SlothVault Docker 镜像，默认发布的 latest 镜像。")
    parser.add_argument("--port", help="宿主机 HTTP 端口，默认 3000。")
    parser.add_argument(
        "--encryption-key",
        help="可选的 43 字符 base64url ENCRYPTION_KEY；省略时持久化生成的密钥。",
    )
    parser.add_argument("--version", action="version", version="SlothVault 安装脚本 {0}".format(SCRIPT_VERSION))
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    arguments = parse_arguments(argv)
    try:
        action = prompt_action(arguments.action)
        root_value = arguments.root
        if root_value is None and action == "install":
            root_value = prompt_value("部署根目录", str(DEFAULT_ROOT))
        root = normalize_path(root_value or str(DEFAULT_ROOT), "部署根目录")
        check_docker()
        if action == "install":
            install(arguments, root)
        else:
            operate_existing(action, root)
        return 0
    except (InstallerError, OSError) as error:
        print_error(str(error))
        return 1
    except KeyboardInterrupt:
        print_error("操作已中断，未删除已有部署数据")
        return 130


if __name__ == "__main__":
    sys.exit(main())
