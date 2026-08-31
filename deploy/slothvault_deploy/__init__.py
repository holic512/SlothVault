"""
@file deploy/slothvault_deploy/__init__.py
@project SlothVault
@module Deployment package metadata
@description Declares the self-contained standard-library host deployment package and its immutable Release identity when packaged by CI.
@logic Re-export the injected release metadata so the command-line entrypoint and update checker use one source of version truth.
@dependencies Python standard library
@index_tags deployment,installer,release,metadata,build-identity
@author holic512
"""

from .release_metadata import RELEASE_COMMIT_SHA, RELEASE_REPOSITORY, RELEASE_TAG


__version__ = RELEASE_TAG or "source"
