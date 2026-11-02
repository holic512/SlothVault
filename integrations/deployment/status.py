#!/usr/bin/env python3
"""
@file integrations/deployment/status.py
@project SlothVault
@module Deployment instance inspection
@description Builds a safe, structured snapshot of one managed deployment for the standalone status command.
@logic Read only managed Compose metadata, inspect its Docker containers, and report partial failures without exposing environment variables or credentials.
@dependencies Python standard library, compose metadata, Docker CLI
@index_tags deployment,instance,status,docker,read-only
@author holic512
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any

from slothvault_deploy.compose import COMPOSE_FILE_NAME, MANAGED_COMPOSE_MARKERS
from slothvault_deploy.release import application_identity, parse_release_tag
from slothvault_deploy.system import InstallerError, run_command


def _match(source: str, pattern: str) -> str | None:
    found = re.search(pattern, source, re.MULTILINE)
    return found.group(1) if found else None


def _run(command: tuple[str, ...]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, text=True, capture_output=True, check=False, timeout=12)


def inspect_instance(root_value: str) -> dict[str, Any]:
    root = Path(root_value)
    compose_path = root / COMPOSE_FILE_NAME
    result: dict[str, Any] = {
        "root": str(root), "composePath": str(compose_path), "state": "absent",
        "provider": None, "image": None, "runtimeImage": None, "appVersionSource": None, "appVersion": None, "appCommit": None,
        "port": None, "loopback": None,
        "dataDir": None, "databaseDir": None, "containers": [],
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
                            result["runtimeImage"] = str(config.get("Image") or "")
                            result["appVersion"], result["appCommit"], _ = application_identity(item)
                            result["appVersionSource"] = "release-identity" if result["appVersion"] else None
                            if result["appVersion"] is None and ":" in str(config.get("Image") or ""):
                                image_tag = str(config["Image"]).rsplit(":", 1)[-1]
                                parsed = parse_release_tag(image_tag)
                                result["appVersion"] = parsed.tag if parsed else None
                                result["appVersionSource"] = "image-tag" if parsed else None
                    result["containers"].sort(key=lambda item: item["service"])
    except (OSError, ValueError, json.JSONDecodeError, subprocess.TimeoutExpired):
        result["errors"].append({"scope": "docker", "code": "INSPECT_UNAVAILABLE"})

    return result


def status(arguments):
    snapshot = inspect_instance(arguments.root)
    if snapshot["state"] != "managed":
        raise InstallerError(f"部署状态：{snapshot['state']}；请检查 {snapshot['composePath']}")
    print(f"部署目录：{snapshot['root']}")
    print(f"数据库：{snapshot['provider'] or '-'}")
    print(f"实际应用版本：{snapshot['appVersion'] or '未核实'} ({snapshot['appVersionSource'] or '-'})")
    print(f"实际镜像：{snapshot['runtimeImage'] or '-'}")
    print(f"应用数据：{snapshot['dataDir'] or '-'}")
    if snapshot['databaseDir']:
        print(f"数据库数据：{snapshot['databaseDir']}")
    for container in snapshot['containers']:
        print(f"{container['service']}: {container['state']} / {container['health'] or '未配置健康检查'}")
    if snapshot['errors']:
        raise InstallerError("；".join(item['code'] for item in snapshot['errors']))
    run_command(("docker", "compose", "-f", snapshot['composePath'], "ps", "--all"))


def main(argv=None) -> int:
    from slothvault_deploy.cli import argument_parser, execute
    return execute(argument_parser("查看 SlothVault 实例状态。"), status, argv)


if __name__ == "__main__":
    import sys
    sys.exit(main())
