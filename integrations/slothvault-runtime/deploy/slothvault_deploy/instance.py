"""
@file deploy/slothvault_deploy/instance.py
@project SlothVault
@module Deployment instance inspection
@description Builds a safe, structured snapshot of one managed deployment for CLI and TUI consumers.
@logic Read only managed Compose metadata, inspect its Docker containers, and report partial failures without exposing environment variables or credentials.
@dependencies Python standard library, compose metadata and Docker CLI
@index_tags deployment,instance,status,docker,read-only
@author holic512
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any

from .compose import COMPOSE_FILE_NAME, MANAGED_COMPOSE_MARKERS
from .release import application_identity, parse_release_tag
from .system import normalize_path


def _match(source: str, pattern: str) -> str | None:
    found = re.search(pattern, source, re.MULTILINE)
    return found.group(1) if found else None


def _run(command: tuple[str, ...]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, text=True, capture_output=True, check=False, timeout=12)


def inspect_instance(root_value: str) -> dict[str, Any]:
    root = normalize_path(root_value, "部署根目录")
    compose_path = root / COMPOSE_FILE_NAME
    result: dict[str, Any] = {
        "root": str(root), "composePath": str(compose_path), "state": "absent",
        "provider": None, "image": None, "appVersion": None, "appCommit": None,
        "port": None, "loopback": None,
        "dataDir": None, "databaseDir": None, "containers": [],
        "nginx": {"state": "unknown", "serverName": None, "https": False, "certificate": "unknown"},
        "errors": [],
    }
    try:
        if not compose_path.exists():
            return result
    except OSError:
        result["state"] = "unreadable"
        result["errors"].append({"scope": "compose", "code": "READ_FAILED"})
        return result
    try:
        source = compose_path.read_text(encoding="utf-8")
    except OSError:
        result["state"] = "unreadable"
        result["errors"].append({"scope": "compose", "code": "READ_FAILED"})
        return result
    if not any(marker in source for marker in MANAGED_COMPOSE_MARKERS):
        result["state"] = "unmanaged"
        return result

    result["state"] = "managed"
    result["provider"] = _match(source, r"^# Provider: (sqlite|mysql|postgresql)$")
    result["image"] = _match(source, r"^    image: [\"']?([^\s\"']+)")
    result["dataDir"] = _match(source, r"^# Persistent application data: (.+)$")
    result["databaseDir"] = _match(source, r"^# Persistent (?:MySQL|PostgreSQL) data: (.+)$")
    port_line = _match(source, r"^\s*- [\"']?((?:127\.0\.0\.1:)?\d{1,5}:3000)[\"']?\s*$")
    if port_line:
        result["port"] = int(port_line.rsplit(":", 2)[-2])
        result["loopback"] = port_line.startswith("127.0.0.1:")

    try:
        listed = _run(("docker", "compose", "-f", str(compose_path), "ps", "--all", "--quiet"))
        if listed.returncode != 0:
            result["errors"].append({"scope": "docker", "code": "COMPOSE_PS_FAILED"})
        else:
            ids = [item.strip() for item in listed.stdout.splitlines() if item.strip()]
            if ids:
                inspected = _run(("docker", "inspect", "--type", "container", *ids))
                if inspected.returncode != 0:
                    result["errors"].append({"scope": "docker", "code": "INSPECT_FAILED"})
                else:
                    records = json.loads(inspected.stdout)
                    if not isinstance(records, list):
                        raise ValueError("Docker inspect result must be a list")
                    for item in records:
                        if not isinstance(item, dict):
                            continue
                        state = item.get("State") if isinstance(item.get("State"), dict) else {}
                        config = item.get("Config") if isinstance(item.get("Config"), dict) else {}
                        labels = config.get("Labels") if isinstance(config.get("Labels"), dict) else {}
                        health = state.get("Health") if isinstance(state.get("Health"), dict) else {}
                        service = str(labels.get("com.docker.compose.service") or "?")
                        result["containers"].append({
                            "service": service,
                            "name": str(item.get("Name") or "").lstrip("/"),
                            "state": str(state.get("Status") or "unknown"),
                            "health": health.get("Status"),
                            "image": str(config.get("Image") or ""),
                        })
                        if service == "slothvault":
                            result["appVersion"], result["appCommit"], _ = application_identity(item)
                            if result["appVersion"] is None and ":" in str(config.get("Image") or ""):
                                image_tag = str(config["Image"]).rsplit(":", 1)[-1]
                                parsed = parse_release_tag(image_tag)
                                result["appVersion"] = parsed.tag if parsed else None
                    result["containers"].sort(key=lambda item: item["service"])
    except (OSError, ValueError, json.JSONDecodeError, subprocess.TimeoutExpired):
        result["errors"].append({"scope": "docker", "code": "INSPECT_UNAVAILABLE"})

    # Only the exact installer-managed system site is considered. Docker Nginx
    # cannot be inferred without an explicitly selected container.
    for path in (Path("/etc/nginx/sites-available/slothvault.conf"), Path("/etc/nginx/conf.d/slothvault.conf")):
        try:
            if not path.is_file():
                continue
            site = path.read_text(encoding="utf-8")
            if "# Managed by SlothVault " not in site:
                continue
            result["nginx"] = {
                "state": "configured", "serverName": _match(site, r"^\s*server_name\s+([^;\s]+)"),
                "https": "ssl_certificate " in site,
                "certificate": "unknown",
            }
            if result["nginx"]["https"] and result["nginx"]["serverName"]:
                certificate = Path("/etc/letsencrypt/live") / result["nginx"]["serverName"] / "fullchain.pem"
                try:
                    result["nginx"]["certificate"] = "present" if certificate.is_file() else "missing"
                except OSError:
                    result["errors"].append({"scope": "certificate", "code": "READ_FAILED"})
            break
        except OSError:
            result["errors"].append({"scope": "nginx", "code": "READ_FAILED"})
    return result
