"""
@file integrations/deployment/slothvault_deploy/bridge.py
@project SlothVault
@module Deployment frontend bridge
@description Translates deployment service prompts and results into newline-delimited JSON for the Ink TUI.
@logic Keep Python as the deployment authority while sending safe progress, prompt and snapshot events over pipes.
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
from dataclasses import asdict
from typing import Any

from . import cli
from .deployment_service import check_deployment_update
from .instance import inspect_instance
from .system import InstallerError, normalize_path, set_event_callback, set_progress_callback


def _emit(kind: str, **data: Any) -> None:
    sys.__stdout__.write(json.dumps({"type": kind, **data}, ensure_ascii=False) + "\n")
    sys.__stdout__.flush()


class _LogWriter:
    def __init__(self) -> None:
        self.pending = ""

    def write(self, value: str) -> int:
        self.pending += value
        while "\n" in self.pending:
            line, self.pending = self.pending.split("\n", 1)
            if line.strip():
                _emit("log", message=line[:600])
        return len(value)

    def flush(self) -> None:
        if self.pending.strip():
            _emit("log", message=self.pending[:600])
        self.pending = ""


def _ask(label: str, secret: bool = False) -> str:
    _emit("prompt", label=label[:300], secret=secret)
    answer = sys.__stdin__.readline()
    if not answer:
        raise EOFError("TUI input ended")
    try:
        message = json.loads(answer)
    except json.JSONDecodeError as error:
        raise InstallerError("部署界面输入格式无效") from error
    if message.get("type") == "cancel":
        raise KeyboardInterrupt()
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
    set_event_callback(lambda kind, data: _emit(kind, data=data))
    try:
        action_args = ["--root", known.root, *rest]
        parsed = cli.parse_arguments(action_args)
        if parsed.action == "status":
            _emit("snapshot", data=inspect_instance(known.root))
            code = 0
        elif parsed.action == "check-update":
            checked = check_deployment_update(normalize_path(known.root, "部署根目录"))
            _emit("update", data=asdict(checked))
            code = 0
        else:
            code = cli.main(action_args)
        writer.flush()
        if parsed.action not in ("status", "check-update"):
            _emit("snapshot", data=inspect_instance(known.root))
        _emit("done", code=code)
        return code
    except (InstallerError, OSError, EOFError) as error:
        writer.flush()
        _emit("error", message=str(error)[:600])
        _emit("done", code=1)
        return 1
    except KeyboardInterrupt:
        _emit("done", code=130)
        return 130
    finally:
        set_progress_callback(None)
        set_event_callback(None)
        builtins.input = original_input
        getpass.getpass = original_getpass
        sys.stdout, sys.stderr = original_stdout, original_stderr
