"""
@file deploy/slothvault_deploy/compose.py
@project SlothVault
@module Deployment Compose management
@description Renders, validates and safely operates one private SQLite, MySQL or PostgreSQL Docker Compose deployment.
@logic Collect provider-specific values, render a self-contained Compose file without a YAML dependency, and only mutate files carrying a SlothVault management marker.
@dependencies Python standard library, Docker Engine, Docker Compose v2
@index_tags deployment,installer,docker,compose,sqlite,mysql,postgresql,persistence
@author holic512
"""

from __future__ import annotations

import getpass
import os
import re
import secrets
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence

from .system import (
    InstallerError,
    create_private_directory,
    ensure_fresh_directory,
    path_is_within,
    print_error,
    prompt_value,
    quote_lines,
    run_command,
    validate_image,
    validate_port,
    write_text_atomically,
    yaml_string,
)


DEFAULT_ROOT = Path("/data/slothvault")
DEFAULT_IMAGE = "holic512/slothvault:latest"
COMPOSE_FILE_NAME = "compose.yml"
MANAGED_COMPOSE_MARKER = "# Managed by SlothVault deploy installer"
LEGACY_MANAGED_COMPOSE_MARKER = "# Managed by SlothVault install.py"
MANAGED_COMPOSE_MARKERS = (MANAGED_COMPOSE_MARKER, LEGACY_MANAGED_COMPOSE_MARKER)
VALID_ENCRYPTION_KEY = re.compile(r"^[A-Za-z0-9_-]{43}$")
PUBLISHED_PORT_PATTERN = re.compile(
    r'^(?P<indent>\s*)-\s+"(?:(?P<host>127\.0\.0\.1):)?(?P<port>\d{1,5}):3000"\s*$',
    re.MULTILINE,
)
PROVIDERS = ("sqlite", "mysql", "postgresql")


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
    bind_loopback: bool = False

    @property
    def compose_path(self) -> Path:
        return self.root / COMPOSE_FILE_NAME


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


def database_default(root: Path, provider: str) -> Optional[Path]:
    if provider == "mysql":
        return root / "mysql"
    if provider == "postgresql":
        return root / "postgresql"
    return None


def configure_installation(arguments: object, root: Path) -> DeploymentConfig:
    provider = prompt_provider(getattr(arguments, "provider", None))
    data_default = root / "data"
    from .system import normalize_path

    data_argument = getattr(arguments, "data_dir", None)
    data_dir = normalize_path(
        data_argument or prompt_value("应用持久化数据目录", str(data_default)),
        "应用持久化数据目录",
    )
    database_dir = None
    if provider != "sqlite":
        default_directory = database_default(root, provider)
        assert default_directory is not None
        database_argument = getattr(arguments, "database_dir", None)
        database_dir = normalize_path(
            database_argument
            or prompt_value("{0} 数据库存储目录".format(provider.title()), str(default_directory)),
            "数据库存储目录",
        )
        if path_is_within(database_dir, data_dir) or path_is_within(data_dir, database_dir):
            raise InstallerError("应用数据目录不能与 {0} 数据库存储目录重叠".format(provider))

    argument_port = getattr(arguments, "port", None)
    port_value = str(argument_port) if argument_port is not None else prompt_value("HTTP 端口", "3000")
    port = validate_port(port_value)
    image = validate_image(
        getattr(arguments, "image", None) or prompt_value("SlothVault Docker 镜像", DEFAULT_IMAGE)
    )
    encryption_key = prompt_optional_encryption_key(getattr(arguments, "encryption_key", None))

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
    host_port = "127.0.0.1:{0}:3000".format(config.port) if config.bind_loopback else "{0}:3000".format(config.port)
    lines = [
        "  slothvault:",
        "    image: {0}".format(yaml_string(config.image)),
        "    restart: unless-stopped",
        "    ports:",
        "      - {0}".format(yaml_string(host_port)),
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
    application.extend(["    depends_on:", "      mysql:", "        condition: service_healthy"])
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
            "      - {0}".format(yaml_string("{0}:/var/lib/mysql".format(config.database_dir))),
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
    application.extend(["    depends_on:", "      postgresql:", "        condition: service_healthy"])
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
            "      - {0}".format(yaml_string("{0}:/var/lib/postgresql/data".format(config.database_dir))),
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
            "Compose 文件已存在：{0}。请使用“更新”操作；安装脚本不会覆盖已有部署。".format(config.compose_path)
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


def require_managed_compose(compose_path: Path) -> None:
    if not compose_path.is_file():
        raise InstallerError("未找到脚本生成的 Compose 文件：{0}".format(compose_path))
    try:
        source = compose_path.read_text(encoding="utf-8")
    except OSError as error:
        raise InstallerError("无法读取脚本生成的 Compose 文件：{0}".format(compose_path)) from error
    if not any(marker in source for marker in MANAGED_COMPOSE_MARKERS):
        raise InstallerError("为保护现有部署，脚本拒绝操作不是由它生成的 Compose 文件：{0}".format(compose_path))


def read_published_application_port(compose_path: Path) -> tuple[str, int, bool]:
    try:
        source = compose_path.read_text(encoding="utf-8")
    except OSError as error:
        raise InstallerError("无法读取 Compose 文件：{0}".format(compose_path)) from error
    match = PUBLISHED_PORT_PATTERN.search(source)
    if match is None:
        raise InstallerError("无法从 Compose 文件识别 SlothVault 的端口映射；请使用当前安装脚本重新部署。")
    return source, validate_port(match.group("port")), bool(match.group("host"))


def bind_existing_application_to_loopback(compose_path: Path, source: str) -> bool:
    match = PUBLISHED_PORT_PATTERN.search(source)
    if match is None:
        raise InstallerError("无法更新 Compose 文件中的 SlothVault 端口映射")
    if match.group("host"):
        return False
    port = validate_port(match.group("port"))
    replacement = '{0}- "127.0.0.1:{1}:3000"'.format(match.group("indent"), port)
    updated_source = "{0}{1}{2}".format(source[: match.start()], replacement, source[match.end() :])
    original_mode = compose_path.stat().st_mode & 0o777
    write_text_atomically(compose_path, updated_source, original_mode)
    try:
        run_command(compose_command(compose_path, "config"))
    except InstallerError:
        write_text_atomically(compose_path, source, original_mode)
        raise
    return True


def restore_compose(compose_path: Path, source: str) -> None:
    write_text_atomically(compose_path, source, compose_path.stat().st_mode & 0o777)


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
        from .system import print_info

        print_info("已更新 {0} 中声明的镜像，持久化数据已保留。".format(compose_path))
