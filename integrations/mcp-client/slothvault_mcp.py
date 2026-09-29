#!/usr/bin/env python3
"""
@file slothvault_mcp.py
@project SlothVault
@module MCP Client source entry
@description Runs the Vault-owned Python MCP CLI directly from a checkout or package.
@logic Check the Python baseline, then delegate command handling to the client package.
@dependencies Python 3.10+, slothvault_mcp.cli
@index_tags mcp,client,cli,entrypoint
@author holic512
"""

import sys

if sys.version_info < (3, 10):
    raise SystemExit("SlothVault MCP Client requires Python 3.10 or newer.")

from slothvault_mcp.cli import main


if __name__ == "__main__":
    raise SystemExit(main())
