"""
@file remote.py
@project SlothVault
@module MCP Client remote service
@description Provides authenticated Streamable HTTP operations and server compatibility checks.
@logic Check compatibility, initialize a fresh SDK session, verify identity, then execute one bounded operation.
@dependencies mcp 1.30.0, httpx, storage.py
@index_tags mcp,client,protocol,compatibility,resource
@author holic512
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import os
import re
import tempfile
import time
from datetime import timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from mcp import types
from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.version import SUPPORTED_PROTOCOL_VERSIONS
from pydantic import AnyUrl

from . import __version__
from .storage import append_history

EXPECTED_SERVER = "slothvault-admin-mcp"
RESOURCE_LIMITS = {"managed-file": 10 * 1024 * 1024, "contract-attachment": 25 * 1024 * 1024}
MIME_PATTERN = re.compile(r"^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+(?:\s*;.*)?$")


class ClientError(Exception):
    def __init__(self, message: str, code: str = "MCP_PROTOCOL_ERROR", category: str = "protocol", exit_code: int = 4) -> None:
        super().__init__(message)
        self.code, self.category, self.exit_code = code, category, exit_code


def version_parts(value: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", value or "")
    if not match:
        raise ClientError("Invalid server minimum client version.", "MCP_COMPATIBILITY_INVALID")
    return tuple(map(int, match.groups()))


def compatibility_url(endpoint: str) -> str:
    return endpoint.rstrip("/") + "/compatibility"


async def check_compatibility(client: httpx.AsyncClient, endpoint: str) -> dict[str, Any]:
    try:
        response = await client.get(compatibility_url(endpoint))
    except httpx.TimeoutException as error:
        raise ClientError("SlothVault compatibility request timed out.", "MCP_TIMEOUT", "timeout") from error
    except httpx.RequestError as error:
        raise ClientError("Unable to reach the SlothVault server.", "MCP_NETWORK_ERROR", "network") from error
    if response.status_code == 404:
        return {"status": "legacy-unverified", "source": "legacy-handshake", "minimumClientVersion": None}
    if response.status_code == 401:
        raise ClientError("SlothVault MCP authentication failed.", "MCP_AUTH_FAILED", "auth", 3)
    if response.status_code == 503:
        raise ClientError("SlothVault MCP is unavailable.", "MCP_UNAVAILABLE", "unavailable")
    if response.status_code != 200:
        raise ClientError("Unable to read SlothVault compatibility policy.", "MCP_COMPATIBILITY_UNAVAILABLE", "protocol")
    try:
        policy = response.json()
        if not isinstance(policy, dict) or type(policy.get("schema")) is not int or policy["schema"] != 1 or policy.get("serverName") != EXPECTED_SERVER:
            raise ValueError()
        minimum = policy["minimumClientVersion"]
        server_version = policy["serverVersion"]
        protocols = policy["supportedProtocolVersions"]
        if not isinstance(server_version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", server_version):
            raise ValueError()
        if not isinstance(protocols, list) or not protocols or not all(isinstance(item, str) for item in protocols) or len(set(protocols)) != len(protocols):
            raise ValueError()
        required = version_parts(minimum)
    except (ValueError, KeyError, TypeError) as error:
        raise ClientError("Invalid SlothVault compatibility response.", "MCP_COMPATIBILITY_INVALID") from error
    if version_parts(__version__) < required:
        raise ClientError(f"Client {__version__} is below the server minimum {minimum}. Update the MCP Client in SlothTool.", "MCP_CLIENT_OUTDATED", "compatibility")
    shared = sorted(set(protocols).intersection(SUPPORTED_PROTOCOL_VERSIONS))
    if not shared:
        raise ClientError("MCP Client and server have no compatible protocol version. Update the MCP Client in SlothTool.", "MCP_PROTOCOL_INCOMPATIBLE", "compatibility")
    return {
        "status": "compatible", "source": "server-policy",
        "minimumClientVersion": minimum, "serverVersion": policy.get("serverVersion"),
        "supportedProtocolVersions": protocols, "commonProtocolVersions": shared,
    }


def _model(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(by_alias=True, exclude_none=True, mode="json")
    return value


async def _pages(method: Any, field: str) -> list[dict[str, Any]]:
    cursor = None
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for _ in range(100):
        page = await method(cursor=cursor)
        result.extend(_model(item) for item in getattr(page, field))
        cursor = getattr(page, "nextCursor", None)
        if not cursor:
            return result
        if cursor in seen:
            raise ClientError("MCP pagination cursor repeated.", "MCP_PROTOCOL_ERROR")
        seen.add(cursor)
    raise ClientError("MCP pagination exceeded the supported limit.", "MCP_PROTOCOL_ERROR")


def _resource_policy(uri: str) -> tuple[int, str | None]:
    parsed = urlsplit(uri)
    if parsed.scheme != "slothvault" or parsed.hostname not in RESOURCE_LIMITS:
        raise ClientError("Unsupported protected Resource URI.", "UNSUPPORTED_RESOURCE_URI", "usage", 2)
    if parsed.username or parsed.password or parsed.port or parsed.query or parsed.fragment or not re.fullmatch(r"/[1-9][0-9]*", parsed.path):
        raise ClientError("Resource URI must contain one positive decimal identifier.", "INVALID_RESOURCE_URI", "usage", 2)
    return RESOURCE_LIMITS[parsed.hostname], "application/pdf" if parsed.hostname == "contract-attachment" else None


def _save_resource(result: Any, uri: str, output: str) -> dict[str, Any]:
    limit, required_mime = _resource_policy(uri)
    destination = Path(output).expanduser().resolve()
    if not destination.parent.is_dir():
        raise ClientError("Resource output directory does not exist.", "OUTPUT_DIRECTORY_NOT_FOUND", "usage", 2)
    if destination.exists():
        raise ClientError("Resource output already exists.", "OUTPUT_EXISTS", "usage", 2)
    contents = getattr(result, "contents", None)
    if not isinstance(contents, list) or len(contents) != 1:
        raise ClientError("Expected exactly one Resource content item.", "INVALID_RESOURCE_RESPONSE")
    content = contents[0]
    details = _model(content)
    if str(details.get("uri")) != uri or not isinstance(details.get("blob"), str):
        raise ClientError("Resource response does not match its request.", "INVALID_RESOURCE_RESPONSE")
    mime = details.get("mimeType")
    if not isinstance(mime, str) or not MIME_PATTERN.fullmatch(mime) or (required_mime and mime.lower() != required_mime):
        raise ClientError("Resource MIME type is invalid.", "INVALID_RESOURCE_MIME")
    metadata = details.get("_meta") or {}
    file_name = str(metadata.get("slothvault/file-name") or details.get("name") or "")
    if not file_name or file_name in {".", ".."} or len(file_name) > 255 or "/" in file_name or "\\" in file_name or "\0" in file_name:
        raise ClientError("Resource file name is invalid.", "INVALID_RESOURCE_NAME")
    blob = details["blob"]
    if len(blob) > ((limit + 2) // 3) * 4:
        raise ClientError("Resource exceeds its size limit.", "RESOURCE_TOO_LARGE")
    try:
        data = base64.b64decode(blob, validate=True)
        if not data or len(data) > limit or base64.b64encode(data).decode("ascii") != blob:
            raise ValueError()
    except (binascii.Error, ValueError) as error:
        raise ClientError("Resource blob is invalid or exceeds its size limit.", "INVALID_RESOURCE_BLOB") from error
    descriptor, temporary = tempfile.mkstemp(prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(data)
        os.link(temporary, destination)
        os.chmod(destination, 0o600)
    except FileExistsError as error:
        raise ClientError("Resource output already exists.", "OUTPUT_EXISTS", "usage", 2) from error
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return {"uri": uri, "path": str(destination), "mimeType": mime, "fileName": file_name, "bytes": len(data)}


async def operate(
    profile: dict[str, Any], action: str, *, name: str = "", arguments: dict[str, Any] | None = None,
    output: str | None = None, confirm: Any = None,
) -> dict[str, Any]:
    started = time.monotonic()
    server: dict[str, Any] | None = None
    risk = "unknown"
    try:
        timeout = profile["timeoutMs"] / 1000
        async with httpx.AsyncClient(headers={"Authorization": f"Bearer {profile['apiKey']}"}, timeout=timeout) as client:
            compatibility = await check_compatibility(client, profile["endpoint"])
            async with streamable_http_client(profile["endpoint"], http_client=client) as (read, write, _):
                async with ClientSession(
                    read, write, read_timeout_seconds=timedelta(seconds=timeout),
                    client_info=types.Implementation(name="slothvault-mcp", version=__version__),
                ) as session:
                    initialized = await session.initialize()
                    if initialized.serverInfo.name != EXPECTED_SERVER:
                        raise ClientError("Unexpected MCP server identity.", "UNEXPECTED_SERVER_IDENTITY")
                    if initialized.protocolVersion not in SUPPORTED_PROTOCOL_VERSIONS:
                        raise ClientError("The server negotiated an unsupported MCP protocol.", "MCP_PROTOCOL_INCOMPATIBLE", "compatibility")
                    if compatibility["status"] == "compatible" and initialized.protocolVersion not in compatibility["commonProtocolVersions"]:
                        raise ClientError("The MCP handshake does not match the server compatibility policy.", "MCP_PROTOCOL_INCOMPATIBLE", "compatibility")
                    server = {
                        "name": initialized.serverInfo.name, "version": initialized.serverInfo.version,
                        "protocolVersion": initialized.protocolVersion,
                    }
                    if action in {"doctor", "discovery"}:
                        tools = await _pages(session.list_tools, "tools")
                        prompts = await _pages(session.list_prompts, "prompts")
                        templates = await _pages(session.list_resource_templates, "resourceTemplates")
                        if action == "doctor":
                            result = {"ok": True, "server": server, "compatibility": compatibility, "profile": {"name": profile["name"], "endpoint": profile["endpoint"]}, "capabilities": {"tools": len(tools), "prompts": len(prompts), "resourceTemplates": len(templates)}}
                        else:
                            result = {"server": server, "compatibility": compatibility, "profile": {"name": profile["name"], "endpoint": profile["endpoint"]}, "tools": tools, "prompts": prompts, "resourceTemplates": templates}
                    elif action == "compatibility":
                        result = {"server": server, **compatibility}
                    elif action == "tools.list":
                        result = {"server": server, "tools": await _pages(session.list_tools, "tools")}
                    elif action == "tools.show":
                        tools = await _pages(session.list_tools, "tools")
                        found = next((tool for tool in tools if tool.get("name") == name), None)
                        if not found:
                            raise ClientError(f"Tool not found: {name}.", "TOOL_NOT_FOUND", "usage", 2)
                        result = {"server": server, "tool": found}
                    elif action == "tools.call":
                        tools = await _pages(session.list_tools, "tools")
                        tool = next((item for item in tools if item.get("name") == name), None)
                        if not tool:
                            raise ClientError(f"Tool not found: {name}.", "TOOL_NOT_FOUND", "usage", 2)
                        risk = "read" if tool.get("annotations", {}).get("readOnlyHint") is True else "write"
                        if risk == "write" and not (confirm and confirm(tool, arguments or {})):
                            raise ClientError("Write Tool requires confirmation or --yes.", "MCP_CONFIRMATION_REQUIRED", "confirmation", 2)
                        called = await session.call_tool(name, arguments or {})
                        result = {"server": server, "tool": name, "risk": risk, "result": _model(called)}
                        if called.isError:
                            raise ClientError("MCP Tool reported a business error.", "MCP_BUSINESS_ERROR", "business", 5)
                    elif action == "prompts.list":
                        result = {"server": server, "prompts": await _pages(session.list_prompts, "prompts")}
                    elif action == "prompts.get":
                        result = {"server": server, "prompt": name, "result": _model(await session.get_prompt(name, {k: str(v) for k, v in (arguments or {}).items()}))}
                    elif action == "resources.list":
                        result = {"server": server, "resourceTemplates": await _pages(session.list_resource_templates, "resourceTemplates")}
                    elif action == "resources.read":
                        if not output:
                            raise ClientError("Resource output path is required.", "OUTPUT_REQUIRED", "usage", 2)
                        _resource_policy(name)
                        if Path(output).expanduser().exists():
                            raise ClientError("Resource output already exists.", "OUTPUT_EXISTS", "usage", 2)
                        saved = _save_resource(await session.read_resource(AnyUrl(name)), name, output)
                        result = {"server": server, **saved}
                    else:
                        raise ClientError(f"Unsupported MCP operation: {action}.", "USAGE_ERROR", "usage", 2)
                    result["durationMs"] = int((time.monotonic() - started) * 1000)
                    append_history(profile["name"], server, action, name, risk, True, result["durationMs"], summary="completed")
                    return result
    except ClientError as error:
        append_history(profile["name"], server, action, name, risk, False, int((time.monotonic() - started) * 1000), error_category=error.category, summary=str(error))
        raise
    except (httpx.HTTPError, TimeoutError, asyncio.TimeoutError) as error:
        classified = ClientError("MCP request failed or timed out.", "MCP_NETWORK_ERROR", "network")
        append_history(profile["name"], server, action, name, risk, False, int((time.monotonic() - started) * 1000), error_category=classified.category, summary=str(classified))
        raise classified from error
    except Exception as error:
        classified = ClientError("MCP protocol operation failed.", "MCP_PROTOCOL_ERROR", "protocol")
        append_history(profile["name"], server, action, name, risk, False, int((time.monotonic() - started) * 1000), error_category=classified.category, summary=str(classified))
        raise classified from error
