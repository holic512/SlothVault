"""
@file storage.py
@project SlothVault
@module MCP Client storage
@description Keeps profiles and redacted history under the user's .pipker directory.
@logic Validate before writing, migrate only absent canonical files, and atomically persist private JSON.
@dependencies Python standard library
@index_tags mcp,client,profile,history,storage
@author holic512
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

PROFILE_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
KEY_PATTERN = re.compile(r"^svmcp_[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{43}$")
SECRET_KEY_PATTERN = re.compile(r"authorization|api[-_]?key|token|secret|password|credential|cookie|blob|private[-_]?key", re.I)
CONTENT_KEY_PATTERN = re.compile(r"^(args|arguments|body|content|data|payload|result)$", re.I)
INLINE_KEY_PATTERN = re.compile(r"svmcp_[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{43}|Bearer\s+\S+", re.I)
HISTORY_LIMIT = 200


class StorageError(ValueError):
    def __init__(self, message: str, code: str = "INVALID_CONFIG") -> None:
        super().__init__(message)
        self.code = code
        self.category = "config"
        self.exit_code = 2


def sloth_tool_home() -> Path:
    return Path(os.environ.get("SLOTHTOOL_HOME", Path.home() / ".pipker" / "slothtool"))


def config_path() -> Path:
    return sloth_tool_home() / "plugin-configs" / "slothvault.json"


def history_path() -> Path:
    return sloth_tool_home() / "data" / "slothvault" / "history.json"


def _legacy_path(kind: str) -> Path:
    if kind == "config":
        return sloth_tool_home() / "plugin-configs" / "slothvault-mcp.json"
    return sloth_tool_home() / "data" / "slothvault-mcp" / "history.json"


def storage_status() -> dict[str, Any]:
    def state(current: Path, legacy: Path) -> dict[str, str]:
        a, b = current.exists(), legacy.exists()
        return {
            "state": "conflict" if a and b else "current" if a else "legacy-only" if b else "absent",
            "targetPath": str(current),
            "legacyPath": str(legacy),
        }
    return {
        "config": state(config_path(), _legacy_path("config")),
        "history": state(history_path(), _legacy_path("history")),
    }


def _migrate_if_absent(kind: str) -> None:
    target = config_path() if kind == "config" else history_path()
    old = _legacy_path(kind)
    if not target.exists() and old.is_file():
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        old.replace(target)


def _write_private(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            os.fchmod(handle.fileno(), 0o600)
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def validate_name(value: str) -> str:
    name = str(value or "").strip()
    if not PROFILE_PATTERN.fullmatch(name):
        raise StorageError("Profile name must use 1-64 letters, numbers, dots, underscores, or hyphens.", "INVALID_PROFILE_NAME")
    return name


def validate_key(value: str) -> str:
    key = str(value or "").strip()
    if not KEY_PATTERN.fullmatch(key):
        raise StorageError("MCP Key format is invalid.", "INVALID_API_KEY")
    return key


def normalize_endpoint(value: str) -> str:
    try:
        parsed = urlsplit(str(value or "").strip())
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError()
        path = parsed.path or "/"
        if path == "/":
            path = "/mcp"
        elif not path.endswith("/mcp"):
            raise ValueError()
        host = parsed.hostname or ""
        if ":" in host and not host.startswith("["):
            host = f"[{host}]"
        netloc = host + (f":{parsed.port}" if parsed.port else "")
        return urlunsplit((parsed.scheme, netloc, path, "", ""))
    except (ValueError, TypeError) as error:
        raise StorageError("Endpoint must be an HTTP(S) URL whose path ends in /mcp.", "INVALID_ENDPOINT") from error


def _validated_profile(name: str, value: dict[str, Any]) -> dict[str, Any]:
    name = validate_name(name)
    if not isinstance(value, dict):
        raise StorageError("Profile must be a JSON object.")
    timeout = value.get("timeoutMs", 30_000)
    if isinstance(timeout, bool) or not str(timeout).isdigit() or not 1000 <= int(timeout) <= 300000:
        raise StorageError("Timeout must be 1000-300000 milliseconds.", "INVALID_TIMEOUT")
    return {
        "name": name,
        "endpoint": normalize_endpoint(value.get("endpoint", "")),
        "apiKey": validate_key(value.get("apiKey", "")),
        "timeoutMs": int(timeout),
        "createdAt": str(value.get("createdAt") or _now()),
        "updatedAt": str(value.get("updatedAt") or _now()),
    }


def read_config() -> dict[str, Any]:
    _migrate_if_absent("config")
    path = config_path()
    if not path.exists():
        return {"schemaVersion": 1, "defaultProfile": None, "profiles": {}}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict) or raw.get("schemaVersion") != 1 or not isinstance(raw.get("profiles"), dict):
            raise StorageError("Unsupported configuration schema.", "UNSUPPORTED_CONFIG_VERSION")
        profiles = {name: _validated_profile(name, value) for name, value in raw["profiles"].items()}
        default = raw.get("defaultProfile")
        if default is not None and default not in profiles:
            raise StorageError("Default profile does not exist.", "PROFILE_NOT_FOUND")
        return {"schemaVersion": 1, "defaultProfile": default, "profiles": profiles}
    except (OSError, json.JSONDecodeError) as error:
        raise StorageError("Unable to read SlothVault configuration.", "INVALID_CONFIG") from error


def _public_profile(profile: dict[str, Any], default: str | None) -> dict[str, Any]:
    key = profile["apiKey"]
    return {
        **profile,
        "apiKey": f"{key[:10]}…{key[-4:]}",
        "isDefault": profile["name"] == default,
        "warnings": [
            *(["HTTP endpoint transmits the Key without TLS."] if profile["endpoint"].startswith("http:") else []),
            "The Key is stored locally in plain text.",
        ],
    }


def config_summary() -> dict[str, Any]:
    config = read_config()
    return {
        "schemaVersion": 1,
        "defaultProfile": config["defaultProfile"],
        "configPath": str(config_path()),
        "profiles": [_public_profile(p, config["defaultProfile"]) for p in config["profiles"].values()],
    }


def resolve_profile(name: str | None = None) -> dict[str, Any]:
    config = read_config()
    selected = validate_name(name) if name else config["defaultProfile"]
    if not selected:
        raise StorageError("No default MCP profile is configured.", "DEFAULT_PROFILE_NOT_SET")
    if selected not in config["profiles"]:
        raise StorageError(f"Profile not found: {selected}.", "PROFILE_NOT_FOUND")
    return dict(config["profiles"][selected])


def save_profile(action: str, name: str, patch: dict[str, Any]) -> dict[str, Any]:
    name = validate_name(name)
    config = read_config()
    existing = config["profiles"].get(name)
    if action == "add" and existing:
        raise StorageError(f"Profile already exists: {name}.", "PROFILE_EXISTS")
    if action == "update" and not existing:
        raise StorageError(f"Profile not found: {name}.", "PROFILE_NOT_FOUND")
    now = _now()
    next_profile = _validated_profile(name, {
        **(existing or {}),
        **patch,
        "createdAt": existing["createdAt"] if existing else now,
        "updatedAt": now,
    })
    config["profiles"][name] = next_profile
    if not config["defaultProfile"] or patch.get("makeDefault"):
        config["defaultProfile"] = name
    _write_private(config_path(), config)
    return _public_profile(next_profile, config["defaultProfile"])


def use_profile(name: str) -> dict[str, Any]:
    name = validate_name(name)
    config = read_config()
    if name not in config["profiles"]:
        raise StorageError(f"Profile not found: {name}.", "PROFILE_NOT_FOUND")
    config["defaultProfile"] = name
    _write_private(config_path(), config)
    return _public_profile(config["profiles"][name], name)


def remove_profile(name: str) -> dict[str, Any]:
    name = validate_name(name)
    config = read_config()
    if name not in config["profiles"]:
        raise StorageError(f"Profile not found: {name}.", "PROFILE_NOT_FOUND")
    del config["profiles"][name]
    if config["defaultProfile"] == name:
        config["defaultProfile"] = sorted(config["profiles"])[0] if config["profiles"] else None
    _write_private(config_path(), config)
    return {"name": name, "defaultProfile": config["defaultProfile"]}


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: "[redacted]" if SECRET_KEY_PATTERN.search(key) or CONTENT_KEY_PATTERN.fullmatch(key) else _redact(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_redact(item) for item in value]
    if isinstance(value, str):
        return INLINE_KEY_PATTERN.sub("[redacted]", value)
    return value


def read_history() -> list[dict[str, Any]]:
    _migrate_if_absent("history")
    path = history_path()
    if not path.exists():
        return []
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if value.get("schemaVersion") != 1 or not isinstance(value.get("entries"), list):
            raise ValueError()
        return value["entries"][:HISTORY_LIMIT]
    except (OSError, ValueError, AttributeError) as error:
        raise StorageError("Unable to read redacted history.", "INVALID_HISTORY") from error


def append_history(profile: str, server: dict[str, Any] | None, operation: str, name: str, risk: str, success: bool, duration_ms: int, *, error_category: str | None = None, summary: Any = "") -> None:
    entries = read_history()
    safe = _redact(summary)
    text = safe if isinstance(safe, str) else json.dumps(safe, ensure_ascii=False)
    entry = {
        "id": str(uuid4()), "timestamp": _now(), "profile": profile,
        "server": server, "operation": operation, "name": name,
        "risk": risk, "durationMs": max(0, duration_ms), "success": success,
        "errorCategory": error_category, "summary": text.replace("\n", " ")[:512],
    }
    _write_private(history_path(), {"schemaVersion": 1, "entries": [entry, *entries][:HISTORY_LIMIT]})


def clear_history() -> dict[str, Any]:
    count = len(read_history())
    _write_private(history_path(), {"schemaVersion": 1, "entries": []})
    return {"cleared": count, "historyPath": str(history_path())}
