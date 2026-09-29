#!/usr/bin/env python3
"""
@file deploy/install.py
@project SlothVault
@module Deployment executable entrypoint
@description Starts the bundled Chinese SlothVault host deployment package from the SlothTool multifunction plugin.
@logic Resolve the sibling package from the packaged deployment directory and delegate all operations to the command-line orchestration module without a Release ZIP.
@dependencies Python standard library, slothvault_deploy package
@index_tags deployment,installer,entrypoint,slothtool,plugin
@author holic512
"""

from __future__ import annotations

import sys
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parent
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from slothvault_deploy.bridge import main  # noqa: E402


if __name__ == "__main__":
    sys.exit(main())
