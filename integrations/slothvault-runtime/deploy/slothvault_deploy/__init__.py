"""
@file deploy/slothvault_deploy/__init__.py
@project SlothVault
@module Deployment package metadata
@description Declares the bundled standard-library host deployment package and the SlothVault application Release source it manages.
@logic Read the Vault toolkit version from the Node launcher while keeping the application Release repository independent from toolkit publication.
@dependencies Python standard library
@index_tags deployment,installer,release,metadata,build-identity
@author holic512
"""

import os

RELEASE_REPOSITORY = "holic512/SlothVault"
__version__ = os.environ.get("SLOTHTOOL_SLOTHVAULT_PLUGIN_VERSION", "source")
