"""
@file cli.py
@project SlothVault
@module MCP Client CLI
@description Exposes source-runnable administrator MCP commands and a JSON bridge for SlothTool.
@logic Keep local profile and history commands separate from guarded remote operations and redact every error.
@dependencies Python standard library, storage.py, remote.py
@index_tags mcp,client,cli,profile,tools,prompts,resources
@author holic512
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import json
import os
import sys
from pathlib import Path
from typing import Any

from . import __version__
from .remote import ClientError, operate
from .storage import (
    StorageError, clear_history, config_summary, normalize_endpoint, read_config,
    read_history, remove_profile, resolve_profile, save_profile, storage_status, use_profile,
    validate_key,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="slothvault-mcp", description="SlothVault administrator MCP client")
    parser.add_argument("command", nargs="?")
    parser.add_argument("subcommand", nargs="?")
    parser.add_argument("target", nargs="?")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--version", action="store_true")
    parser.add_argument("--profile")
    parser.add_argument("--url")
    parser.add_argument("--timeout", type=int)
    parser.add_argument("--default", action="store_true")
    parser.add_argument("--key-stdin", action="store_true")
    parser.add_argument("--key-env")
    parser.add_argument("--args", dest="arguments")
    parser.add_argument("--args-file")
    parser.add_argument("--output")
    parser.add_argument("--yes", action="store_true")
    return parser


def _print(value: Any, json_mode: bool) -> None:
    if json_mode or isinstance(value, (dict, list)):
        print(json.dumps(value, ensure_ascii=False, indent=2))
    else:
        print(value)


def _key(args: argparse.Namespace) -> str:
    if args.key_stdin and args.key_env:
        raise StorageError("Use only one Key input source.", "KEY_SOURCE_CONFLICT")
    if args.key_stdin:
        value = sys.stdin.readline()
    elif args.key_env:
        value = os.environ.get(args.key_env, "")
    elif sys.stdin.isatty() and not args.json:
        value = getpass.getpass("MCP Key: ")
    else:
        raise StorageError("Provide --key-stdin or --key-env for noninteractive setup.", "KEY_SOURCE_REQUIRED")
    return validate_key(value)


def _arguments(args: argparse.Namespace) -> dict[str, Any]:
    if args.arguments is not None and args.args_file:
        raise StorageError("Use either --args or --args-file.", "ARGS_SOURCE_CONFLICT")
    if args.args_file:
        text = sys.stdin.read() if args.args_file == "-" else Path(args.args_file).read_text(encoding="utf-8")
    else:
        text = args.arguments or "{}"
    try:
        value = json.loads(text)
    except json.JSONDecodeError as error:
        raise StorageError("Arguments must contain valid JSON.", "INVALID_ARGS") from error
    if not isinstance(value, dict):
        raise StorageError("Arguments must be a JSON object.", "INVALID_ARGS")
    return value


def _confirm(tool: dict[str, Any], arguments: dict[str, Any], yes: bool, json_mode: bool) -> bool:
    if yes:
        return True
    if json_mode or not sys.stdin.isatty() or not sys.stdout.isatty():
        return False
    print(f"Tool {tool['name']} may modify remote data. Argument fields: {', '.join(arguments) or '(none)'}")
    return input("Type yes to continue: ").strip().lower() in {"y", "yes"}


async def _setup(args: argparse.Namespace) -> dict[str, Any]:
    endpoint = args.url
    if not endpoint and sys.stdin.isatty() and not args.json:
        endpoint = input("SlothVault server URL: ")
    if not endpoint:
        raise StorageError("Setup requires --url.", "ENDPOINT_REQUIRED")
    endpoint = normalize_endpoint(endpoint)
    key = _key(args)
    current = read_config()
    existing = next((p for p in current["profiles"].values() if p["endpoint"] == endpoint), None)
    name = existing["name"] if existing else "default"
    counter = 2
    while not existing and name in current["profiles"]:
        name = f"connection-{counter}"
        counter += 1
    profile = save_profile("update" if existing else "add", name, {
        "endpoint": endpoint, "apiKey": key, "timeoutMs": args.timeout or 30000, "makeDefault": True,
    })
    try:
        checked = await operate(resolve_profile(name), "doctor")
        return {"saved": True, "connected": True, "profile": profile, "server": checked["server"]}
    except ClientError as error:
        return {"saved": True, "connected": False, "profile": profile, "error": {"code": error.code, "category": error.category}}


def _local(args: argparse.Namespace) -> Any:
    command, action, name = args.command, args.subcommand, args.target
    if command == "config":
        return config_summary()
    if command == "storage":
        if action not in (None, "status"):
            raise StorageError("Unknown storage action.", "USAGE_ERROR")
        return storage_status()
    if command == "history":
        if action in (None, "list"):
            return read_history()
        if action == "show":
            found = next((entry for entry in read_history() if entry.get("id") == name), None)
            if not found:
                raise StorageError("History entry not found.", "HISTORY_NOT_FOUND")
            return found
        if action == "clear":
            if not args.yes and (args.json or not sys.stdin.isatty() or input("Clear redacted history? Type yes: ").strip().lower() not in {"yes", "y"}):
                raise StorageError("History clear requires confirmation or --yes.", "CONFIRMATION_REQUIRED")
            return clear_history()
        raise StorageError("Unknown history action.", "USAGE_ERROR")
    if command == "profile":
        if action in (None, "list"):
            return config_summary()["profiles"]
        if not name:
            raise StorageError("Profile name is required.", "PROFILE_NAME_REQUIRED")
        if action == "show":
            return next((p for p in config_summary()["profiles"] if p["name"] == name), None) or _missing_profile(name)
        if action == "use":
            return use_profile(name)
        if action == "remove":
            return remove_profile(name)
        if action in {"add", "update"}:
            patch: dict[str, Any] = {}
            if args.url:
                patch["endpoint"] = args.url
            if args.timeout is not None:
                patch["timeoutMs"] = args.timeout
            if args.default:
                patch["makeDefault"] = True
            if action == "add" or args.key_stdin or args.key_env:
                patch["apiKey"] = _key(args)
            return save_profile(action, name, patch)
        raise StorageError("Unknown profile action.", "USAGE_ERROR")
    raise StorageError("Unknown local command.", "USAGE_ERROR")


def _missing_profile(name: str) -> Any:
    raise StorageError(f"Profile not found: {name}.", "PROFILE_NOT_FOUND")


async def _remote(args: argparse.Namespace) -> Any:
    command, action, name = args.command, args.subcommand, args.target
    profile = resolve_profile(args.profile)
    if command in {"doctor", "discovery", "compatibility"}:
        return await operate(profile, command)
    if command == "tools":
        if action in {"list", "show", "call"}:
            if action != "list" and not name:
                raise StorageError("Tool name is required.", "TOOL_REQUIRED")
            result = await operate(profile, f"tools.{action}", name=name or "", arguments=_arguments(args) if action == "call" else None,
                                   confirm=lambda tool, arguments: _confirm(tool, arguments, args.yes, args.json))
            return result["tools"] if action == "list" else result
    if command == "prompts":
        if action in {"list", "get"}:
            if action == "get" and not name:
                raise StorageError("Prompt name is required.", "PROMPT_REQUIRED")
            result = await operate(profile, f"prompts.{action}", name=name or "", arguments=_arguments(args) if action == "get" else None)
            return result["prompts"] if action == "list" else result
    if command == "resources":
        if action in {"list", "read"}:
            if action == "read" and not name:
                raise StorageError("Resource URI is required.", "RESOURCE_REQUIRED")
            result = await operate(profile, f"resources.{action}", name=name or "", output=args.output)
            return result["resourceTemplates"] if action == "list" else result
    raise StorageError("Unknown MCP command.", "USAGE_ERROR")


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if any(value == "--key" or value.startswith("--key=") for value in argv):
        error = StorageError("Raw --key arguments are not supported; use stdin or an environment variable.", "USAGE_ERROR")
        print(json.dumps({"ok": False, "error": {"code": error.code, "category": error.category, "message": str(error)}}) if "--json" in argv else f"Error: {error}", file=sys.stdout if "--json" in argv else sys.stderr)
        return error.exit_code
    parser = _parser()
    args = parser.parse_args(argv)
    if args.version:
        _print({"version": __version__, "bridgeApiMajor": 2}, args.json)
        return 0
    if not args.command:
        parser.print_help()
        return 0
    try:
        if args.command == "setup":
            result = asyncio.run(_setup(args))
            _print(result, args.json)
            return 0 if result["connected"] else 4
        if args.command in {"config", "storage", "history", "profile"}:
            result = _local(args)
        else:
            result = asyncio.run(_remote(args))
        _print(result, args.json)
        return 0
    except (StorageError, ClientError, OSError) as error:
        code = getattr(error, "code", "MCP_LOCAL_ERROR")
        category = getattr(error, "category", "internal")
        message = str(error) if not isinstance(error, OSError) else "Local MCP operation failed."
        if args.json:
            _print({"ok": False, "error": {"code": code, "category": category, "message": message}}, True)
        else:
            print(f"Error: {message}", file=sys.stderr)
        return int(getattr(error, "exit_code", 1))
