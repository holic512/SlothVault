"""
@file deploy/slothvault_deploy/release_metadata.py
@project SlothVault
@module Deployment release metadata
@description Declares source-tree fallback values for deployment-package release identity.
@logic Provide safe unversioned defaults for source checkouts; the GitHub Release workflow replaces this file in the deployment ZIP with the immutable release tag and commit SHA.
@dependencies Python standard library
@index_tags deployment,release,metadata,build-identity
@author holic512
"""

from __future__ import annotations

from typing import Optional


RELEASE_TAG: Optional[str] = None
RELEASE_COMMIT_SHA: Optional[str] = None
RELEASE_REPOSITORY = "holic512/SlothVault"
