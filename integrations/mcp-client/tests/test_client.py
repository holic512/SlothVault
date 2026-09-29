"""Validate the MCP Client compatibility and local safety boundaries."""

import asyncio
import base64
from contextlib import asynccontextmanager
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from mcp.shared.version import SUPPORTED_PROTOCOL_VERSIONS

from slothvault_mcp import remote
from slothvault_mcp.remote import ClientError, _save_resource, check_compatibility
from slothvault_mcp.storage import config_summary, read_history, save_profile


class CompatibilityTests(unittest.TestCase):
    def run_policy(self, status, policy=None):
        requests = []

        def handler(request):
            requests.append(request)
            return httpx.Response(status, json=policy or {})

        async def call():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler),
                                         headers={"Authorization": "Bearer placeholder"}) as client:
                return await check_compatibility(client, "https://vault.example/mcp")

        return requests, call

    def policy(self, **overrides):
        return {"schema": 1, "serverName": "slothvault-admin-mcp", "serverVersion": "3.1.0",
                "minimumClientVersion": "1.0.0", "supportedProtocolVersions": [SUPPORTED_PROTOCOL_VERSIONS[0]],
                **overrides}

    def test_success_and_bearer_boundary(self):
        requests, call = self.run_policy(200, self.policy())
        result = asyncio.run(call())
        self.assertEqual(result["status"], "compatible")
        self.assertEqual(requests[0].url.path, "/mcp/compatibility")
        self.assertEqual(requests[0].headers["Authorization"], "Bearer placeholder")

    def test_minimum_version_blocks_operation(self):
        _, call = self.run_policy(200, self.policy(minimumClientVersion="9.0.0"))
        with self.assertRaises(ClientError) as failure:
            asyncio.run(call())
        self.assertEqual(failure.exception.code, "MCP_CLIENT_OUTDATED")

    def test_protocol_mismatch_blocks_operation(self):
        _, call = self.run_policy(200, self.policy(supportedProtocolVersions=["1900-01-01"]))
        with self.assertRaises(ClientError) as failure:
            asyncio.run(call())
        self.assertEqual(failure.exception.code, "MCP_PROTOCOL_INCOMPATIBLE")

    def test_invalid_server_version_is_rejected(self):
        _, call = self.run_policy(200, self.policy(serverVersion="invalid"))
        with self.assertRaises(ClientError) as failure:
            asyncio.run(call())
        self.assertEqual(failure.exception.code, "MCP_COMPATIBILITY_INVALID")

    def test_legacy_server_marks_minimum_unverified(self):
        _, call = self.run_policy(404)
        result = asyncio.run(call())
        self.assertEqual(result["status"], "legacy-unverified")
        self.assertIsNone(result["minimumClientVersion"])


class LocalBoundaryTests(unittest.TestCase):
    def test_profiles_and_history_stay_under_pipker_without_exposing_key(self):
        with tempfile.TemporaryDirectory() as home:
            key = "svmcp_" + "a" * 24 + "." + "b" * 43
            with patch.dict(os.environ, {"SLOTHTOOL_HOME": home}):
                save_profile("add", "local", {"endpoint": "https://vault.example/mcp", "apiKey": key})
                summary = config_summary()
                self.assertEqual(summary["configPath"], str(Path(home) / "plugin-configs" / "slothvault.json"))
                self.assertNotIn(key, str(summary))
                self.assertEqual(read_history(), [])

    def test_resource_download_rejects_overwrite_and_invalid_uri(self):
        with tempfile.TemporaryDirectory() as home:
            uri = "slothvault://managed-file/42"
            blob = base64.b64encode(b"safe content").decode()
            response = SimpleNamespace(contents=[{"uri": uri, "blob": blob, "mimeType": "text/plain",
                                                  "name": "document.txt", "_meta": {}}])
            target = str(Path(home) / "document.txt")
            saved = _save_resource(response, uri, target)
            self.assertEqual(saved["bytes"], 12)
            with self.assertRaises(ClientError) as failure:
                _save_resource(response, uri, target)
            self.assertEqual(failure.exception.code, "OUTPUT_EXISTS")
            with self.assertRaises(ClientError):
                _save_resource(response, "https://vault.example/private", str(Path(home) / "other.txt"))

    def test_write_tool_requires_confirmation_and_read_only_hint_is_exact(self):
        calls = []
        tool = {"name": "example.write", "annotations": {}}

        @asynccontextmanager
        async def stream(*args, **kwargs):
            yield None, None, None

        class Session:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def initialize(self):
                return SimpleNamespace(serverInfo=SimpleNamespace(name="slothvault-admin-mcp", version="3.1.0"),
                                       protocolVersion=SUPPORTED_PROTOCOL_VERSIONS[0])

            async def list_tools(self, cursor=None):
                return SimpleNamespace(tools=[tool], nextCursor=None)

            async def call_tool(self, name, arguments):
                calls.append((name, arguments))
                return SimpleNamespace(isError=False, model_dump=lambda **kwargs: {"isError": False})

        profile = {"name": "local", "endpoint": "https://vault.example/mcp", "apiKey": "placeholder", "timeoutMs": 1000}
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {"SLOTHTOOL_HOME": home}), \
             patch.object(remote, "check_compatibility", AsyncMock(return_value={"status": "compatible", "commonProtocolVersions": [SUPPORTED_PROTOCOL_VERSIONS[0]]})), \
             patch.object(remote, "streamable_http_client", stream), \
             patch.object(remote, "ClientSession", lambda *args, **kwargs: Session()):
            with self.assertRaises(ClientError) as failure:
                asyncio.run(remote.operate(profile, "tools.call", name=tool["name"], arguments={"secret": "value"},
                                           confirm=lambda *_: False))
            self.assertEqual(failure.exception.code, "MCP_CONFIRMATION_REQUIRED")
            self.assertEqual(calls, [])
            tool["annotations"]["readOnlyHint"] = True
            asyncio.run(remote.operate(profile, "tools.call", name=tool["name"], arguments={},
                                       confirm=lambda *_: False))
            self.assertEqual(len(calls), 1)
            self.assertNotIn("value", str(read_history()))

    def test_handshake_must_match_server_policy(self):
        @asynccontextmanager
        async def stream(*args, **kwargs):
            yield None, None, None

        class Session:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def initialize(self):
                return SimpleNamespace(serverInfo=SimpleNamespace(name="slothvault-admin-mcp", version="3.1.0"),
                                       protocolVersion=SUPPORTED_PROTOCOL_VERSIONS[0])

        profile = {"name": "local", "endpoint": "https://vault.example/mcp", "apiKey": "placeholder", "timeoutMs": 1000}
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {"SLOTHTOOL_HOME": home}), \
             patch.object(remote, "check_compatibility", AsyncMock(return_value={"status": "compatible", "commonProtocolVersions": ["1900-01-01"]})), \
             patch.object(remote, "streamable_http_client", stream), \
             patch.object(remote, "ClientSession", lambda *args, **kwargs: Session()):
            with self.assertRaises(ClientError) as failure:
                asyncio.run(remote.operate(profile, "doctor"))
        self.assertEqual(failure.exception.code, "MCP_PROTOCOL_INCOMPATIBLE")


if __name__ == "__main__":
    unittest.main()
