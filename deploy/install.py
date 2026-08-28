#!/usr/bin/env python3
"""
@file deploy/install.py
@project SlothVault
@module Deployment executable entrypoint
@description Starts the self-contained Chinese SlothVault host deployment package after it has been extracted from a Release ZIP.
@logic Resolve the sibling package from the extracted deployment directory and delegate all operations to the command-line orchestration module.
@dependencies Python standard library, slothvault_deploy package
@index_tags deployment,installer,entrypoint,release
@author holic512
"""

from __future__ import annotations

import sys
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parent
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from slothvault_deploy.cli import main  # noqa: E402


if __name__ == "__main__":
    sys.exit(main())
