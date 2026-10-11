"""
@file integrations/deployment/slothvault_deploy/bridge.py
@project SlothVault
@module Deployment frontend bridge
@description Translates deployment service prompts and results into newline-delimited JSON for the Ink TUI.
@logic Review and confirm one application target, forward measured command events, and finish with an actual snapshot and explicit outcome.
@dependencies Python standard library, deployment service, instance inspection
@index_tags deployment,tui,protocol,prompt,status
@author holic512
"""

from __future__ import annotations

import argparse
import builtins
import getpass
import json
import sys
import threading
from dataclasses import asdict
from typing import Any

from . import cli
from .deployment_service import check_deployment_update
from .release import update_managed_application
from .instance import inspect_instance
from .system import InstallerError, normalize_path, set_event_callback, set_progress_callback, set_confirmation_callback, check_docker, safe_message


_output_lock = threading.Lock()


def _emit(event_type: str, **data: Any) -> None:
    with _output_lock:
        sys.__stdout__.write(json.dumps({"type": event_type, **data}, ensure_ascii=False) + "\n")
        sys.__stdout__.flush()


class _LogWriter:
    def __init__(self) -> None:
        self.pending = ""

    def write(self, value: str) -> int:
        self.pending += value
        while "\n" in self.pending:
            line, self.pending = self.pending.split("\n", 1)
            if line.strip():
                _emit("log", message=safe_message(line))
        return len(value)

    def flush(self) -> None:
        if self.pending.strip():
            _emit("log", message=safe_message(self.pending))
        self.pending = ""


def _ask(label: str, secret: bool = False, **context: Any) -> str:
    _emit("prompt", label=safe_message(label)[:300], secret=secret, **context)
    answer = sys.__stdin__.readline()
    if not answer:
        raise EOFError("TUI input ended")
    try:
        message = json.loads(answer)
    except json.JSONDecodeError as error:
        raise InstallerError("部署界面输入格式无效") from error
    if not isinstance(message, dict):
        raise InstallerError("部署界面输入格式无效")
    if message.get("type") == "cancel":
        raise KeyboardInterrupt()
    if message.get("type") != "answer":
        raise InstallerError("部署界面输入类型无效")
    value = message.get("value")
    if not isinstance(value, str) or len(value) > 4096:
        raise InstallerError("部署界面输入值无效")
    return value


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--snapshot-json", action="store_true")
    parser.add_argument("--bridge", action="store_true")
    parser.add_argument("--root", default="/data/slothvault")
    known, rest = parser.parse_known_args(argv)
    if known.snapshot_json:
        print(json.dumps(inspect_instance(known.root), ensure_ascii=False))
        return 0
    if not known.bridge:
        return cli.main(argv)

    original_input = builtins.input
    original_getpass = getpass.getpass
    original_stdout, original_stderr = sys.stdout, sys.stderr
    writer = _LogWriter()
    builtins.input = lambda prompt="": _ask(str(prompt))
    getpass.getpass = lambda prompt="", stream=None: _ask(str(prompt), secret=True)
    sys.stdout = writer
    sys.stderr = writer
    set_progress_callback(lambda phase: _emit("progress", phase=phase))
    context = {}
    def forward(kind: str, data: dict[str, object]) -> None:
        if kind == "preview" and data.get("targetVersion"):
            context.update(beforeVersion=data.get("currentVersion"), targetVersion=data["targetVersion"])
        if kind == "progress":
            _emit(kind, **data)
        else:
            _emit(kind, data=data)
    set_event_callback(forward)
    set_confirmation_callback(lambda label, default: _ask(label, kind="confirm", default=default))
    code, outcome = 1, {"outcome": "failed"}
    parsed = None
    try:
        action_args = ["--root", known.root, *rest]
        parsed = cli.parse_arguments(action_args)
        if parsed.action == "status":
            _emit("snapshot", data=inspect_instance(known.root))
            code = 0
        elif parsed.action == "check-update":
            checked = check_deployment_update(normalize_path(known.root, "部署根目录"))
            _emit("update", data=asdict(checked))
            code = 1 if checked.error else 0
        elif parsed.action == "update":
            check_docker()
            outcome = update_managed_application(normalize_path(known.root, "部署根目录"))
            code = 0
        else:
            code = cli.main(action_args)
        if parsed.action != "update":
            outcome = {"outcome": "failed"} if code else {}
    except (InstallerError, OSError, EOFError) as error:
        writer.flush()
        _emit("error", message=safe_message(str(error)), code="DEPLOYMENT_FAILED")
        code, outcome = 1, {"outcome": "failed"}
    except KeyboardInterrupt:
        code, outcome = 130, {"outcome": "cancelled"}
    except Exception:
        code, outcome = 1, {"outcome": "failed"}
        _emit("error", message="部署执行出现内部错误，请检查部署状态。", code="DEPLOYMENT_FAILED")
    finally:
        writer.flush()
        if parsed is not None and parsed.action != "status":
            try:
                snapshot = inspect_instance(known.root)
                context["currentVersion"] = snapshot.get("appVersion")
                _emit("snapshot", data=snapshot)
            except Exception:
                outcome["verified"] = False
                context["currentVersion"] = None
                _emit("snapshot", data={"root": known.root, "state": "unreadable", "appVersion": None,
                                        "errors": [{"scope": "snapshot", "code": "READ_FAILED"}]})
        _emit("done", code=code, **{**outcome, **context})
        set_progress_callback(None)
        set_event_callback(None)
        set_confirmation_callback(None)
        builtins.input = original_input
        getpass.getpass = original_getpass
        sys.stdout, sys.stderr = original_stdout, original_stderr
    return code
