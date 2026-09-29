"""
@file integrations/deployment/slothvault_deploy/__init__.py
@project SlothVault
@module Deployment package metadata
@description Declares the bundled standard-library host deployment package and the SlothVault application Release source it manages.
@logic Read the independent deployment module version while keeping application Releases separate.
@dependencies Python standard library
@index_tags deployment,installer,release,metadata,build-identity
@author holic512
"""

import json
from pathlib import Path

RELEASE_REPOSITORY = "holic512/SlothVault"
__version__ = json.loads((Path(__file__).resolve().parents[1] / "module.json").read_text(encoding="utf-8"))["version"]
