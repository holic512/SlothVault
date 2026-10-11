"""
@file progress.py
@project SlothVault
@module Deployment command observation
@description Streams safe Docker progress and process heartbeats without forwarding sensitive command output.
@logic Detect Compose progress support, drain both pipes, publish measured layer events, and stop child processes on interruption.
@dependencies Python standard library, Docker Compose CLI
@index_tags deployment,progress,docker,redaction,heartbeat
@author holic512
"""

from __future__ import annotations

import json
import math
import queue
import re
import subprocess
import threading
import time
from functools import lru_cache
from typing import Callable, Sequence


_STATES = re.compile(r"\b(Pulling fs layer|Pulling|Downloading|Download complete|Extracting|Extract complete|Pull complete|Already exists|Waiting|Creating|Created|Recreating|Recreated|Starting|Started|Running|Healthy|Stopping|Stopped|Removed)\b", re.I)
_AMOUNT = re.compile(r"([\d.]+)\s*(B|kB|KB|MB|GB|KiB|MiB|GiB)\s*/\s*([\d.]+)\s*(B|kB|KB|MB|GB|KiB|MiB|GiB)")
_UNITS = {"B": 1, "kB": 1000, "KB": 1000, "MB": 1000**2, "GB": 1000**3, "KiB": 1024, "MiB": 1024**2, "GiB": 1024**3}
_ERRORS = (("unauthorized|authentication required|denied", "镜像仓库拒绝访问，请检查仓库权限。"),
           ("no such host|name resolution", "镜像仓库地址解析失败。"),
           ("timeout|timed out|deadline exceeded", "连接镜像仓库超时。"),
           ("certificate|tls handshake", "镜像仓库 TLS 连接失败。"),
           ("no space left", "磁盘空间不足。"),
           ("manifest unknown|not found", "目标镜像或资源不存在。"),
           ("cannot connect|connection refused", "无法连接 Docker 服务或镜像仓库。"))


@lru_cache(maxsize=4)
def compose_progress_mode(executable: str) -> str | None:
    try:
        result = subprocess.run([executable, "compose", "--help"], capture_output=True, text=True, timeout=5)
        help_text = result.stdout
        if result.returncode == 0 and "--progress" in help_text:
            return "json" if re.search(r"\bjson\b", help_text) else "plain"
    except (OSError, subprocess.TimeoutExpired):
        pass
    return None


def _subject(value: object) -> str | None:
    return value if isinstance(value, str) and re.fullmatch(r"(?:(?:sha256:)?[a-fA-F0-9]{6,64}|(?:docker.io/)?holic512/slothvault(?::[A-Za-z0-9._-]+)?|(?:slothvault|mysql|postgres|postgresql|nginx)(?:[-_][A-Za-z0-9._-]+)?)", value, re.ASCII) else None


def parse_progress(line: str) -> dict[str, object] | None:
    """Accept only known activity and numeric progress; arbitrary details are never emitted."""
    try:
        data = json.loads(line)
    except ValueError:
        data = None
    if isinstance(data, dict):
        text = str(data.get("text", ""))
        found = _STATES.search(text)
        if not found:
            return None
        subject = _subject(data.get("id"))
        current, total = data.get("current", 0), data.get("total")
    else:
        # Strip terminal controls before matching plain Compose output.
        line = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", line)
        found = _STATES.search(line)
        if not found:
            return None
        prefix = line[:found.start()].strip().split()
        subject = _subject(prefix[-1]) if prefix else None
        amounts = _AMOUNT.search(line[found.end():])
        current = int(float(amounts[1]) * _UNITS[amounts[2]]) if amounts else None
        total = int(float(amounts[3]) * _UNITS[amounts[4]]) if amounts else None
    activity = found[0].lower()
    completed = activity in ("download complete", "extract complete", "pull complete", "already exists", "created", "recreated", "started", "running", "healthy", "stopped", "removed")
    event: dict[str, object] = {"status": "completed" if completed else "running", "message": activity}
    event["subject"] = subject or "?"
    if activity in ("downloading", "extracting") and isinstance(current, (int, float)) and not isinstance(current, bool) and math.isfinite(current) and current >= 0:
        event.update(current=current, unit="bytes")
        if subject and isinstance(total, (int, float)) and not isinstance(total, bool) and math.isfinite(total) and total > 0 and current <= total:
            event["total"] = total
    return event


def run_observed_command(command: Sequence[str], publish: Callable[[dict[str, object]], None]) -> None:
    args = list(command)
    if len(args) > 2 and args[1] == "compose" and any(part in ("pull", "up", "start", "stop") for part in args[2:]):
        mode = compose_progress_mode(args[0])
        if mode:
            args[2:2] = ["--progress", mode]
    child = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
    messages: queue.Queue[str | None] = queue.Queue(maxsize=256)

    stopping = threading.Event()

    def enqueue(value: str | None) -> None:
        while not stopping.is_set():
            try:
                messages.put(value, timeout=0.2)
                return
            except queue.Full:
                continue

    def drain(stream: object) -> None:
        try:
            for line in iter(lambda: stream.readline(16_384), ""):
                enqueue(line)
        finally:
            enqueue(None)

    readers = [threading.Thread(target=drain, args=(stream,), daemon=True) for stream in (child.stdout, child.stderr)]
    for reader in readers:
        reader.start()
    ended, heartbeat = 0, time.monotonic()
    measurements: dict[tuple[object, object], tuple[float, float]] = {}
    reason = None
    try:
        while ended < 2:
            try:
                line = messages.get(timeout=0.2)
            except queue.Empty:
                line = ""
            if line is None:
                ended += 1
            elif line:
                event = parse_progress(line)
                if event:
                    if event.get("unit") == "bytes":
                        key = (event.get("subject"), event.get("message"))
                        now = time.monotonic()
                        previous = measurements.get(key)
                        if previous and now > previous[0] and event["current"] >= previous[1]:
                            event["speed"] = (event["current"] - previous[1]) / (now - previous[0])
                        measurements[key] = (now, event["current"])
                    publish(event)
                else:
                    for pattern, safe in _ERRORS:
                        if re.search(pattern, line, re.I):
                            reason = safe
                            break
            if time.monotonic() - heartbeat >= 5:
                publish({"heartbeat": True, "status": "running"})
                heartbeat = time.monotonic()
        code = child.wait()
        if code:
            raise subprocess.CalledProcessError(code, args, stderr=reason)
    finally:
        stopping.set()
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        for reader in readers:
            reader.join(timeout=2)
        for stream in (child.stdout, child.stderr):
            stream.close()
