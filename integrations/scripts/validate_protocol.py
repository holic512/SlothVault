#!/usr/bin/env python3
"""
@file validate_protocol.py
@project SlothVault
@module Integration protocol validation
@description Checks the machine-readable cross-workspace contract against module metadata and examples.
@logic Check the two independent modules, native MCP server identity, and unchanged deployment bridge examples.
@dependencies Python standard library, integrations/protocol/contract.json
@index_tags integrations,protocol,contract,validation
@author holic512
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = ROOT / "protocol"


def main() -> None:
    contract = json.loads((PROTOCOL / "contract.json").read_text(encoding="utf-8"))
    assert contract["schema"] == 1
    assert set(contract["modules"]) == {"skill", "deployment"}
    for name, expected in contract["modules"].items():
        module = json.loads((ROOT / name / "module.json").read_text(encoding="utf-8"))
        assert module["schema"] == 1 and module["module"] == name
        assert re.fullmatch(r"\d+\.\d+\.\d+", module["version"])
        assert module["bridgeApiMajor"] == expected["protocolMajor"]
        assert module.get("minPython") == expected.get("minPython")
        assert (ROOT / name / expected["entry"]).is_file()
    server = (ROOT.parent / "src" / "server" / "mcp" / "server.ts").read_text(encoding="utf-8")
    assert f"ADMIN_MCP_SERVER_NAME = '{contract['serverName']}'" in server
    events = [json.loads(line) for line in (PROTOCOL / "examples" / "bridge-events.jsonl").read_text(encoding="utf-8").splitlines()]
    assert all(item["type"] in {"progress", "snapshot", "update", "preview", "prompt", "log", "error", "done"} for item in events)
    assert events[-1]["type"] == "done" and isinstance(events[-1]["code"], int)
    print("SlothVault integration protocol: valid")


if __name__ == "__main__":
    main()
