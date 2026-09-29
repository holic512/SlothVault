"""
@file __init__.py
@project SlothVault
@module MCP Client package metadata
@description Exposes the installed client version from the immutable module metadata.
@logic Read the adjacent module manifest so CLI and compatibility checks share one version.
@dependencies Python standard library, module.json
@index_tags mcp,client,version,metadata
@author holic512
"""

import json
from pathlib import Path

METADATA = json.loads((Path(__file__).resolve().parents[1] / "module.json").read_text(encoding="utf-8"))
__version__ = METADATA["version"]
