#!/usr/bin/env python3
"""
@file integrations/deployment/install.py
@project SlothVault
@module Deployment executable entrypoint
@description Starts the independently published SlothVault host deployment package directly or from SlothTool.
@logic Resolve the sibling package from the packaged deployment directory and delegate all operations to the command-line orchestration module without a Release ZIP.
@dependencies Python standard library, slothvault_deploy package
@index_tags deployment,installer,entrypoint,slothtool,plugin
@author holic512
"""

from __future__ import annotations

import sys
from pathlib import Path

if sys.version_info < (3, 10):
    raise SystemExit("SlothVault deployment requires Python 3.10 or newer.")


PACKAGE_ROOT = Path(__file__).resolve().parent
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from slothvault_deploy.bridge import main  # noqa: E402


if __name__ == "__main__":
    sys.exit(main())
