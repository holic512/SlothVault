/**
 * @file limits.ts
 * @project SlothVault
 * @module MCP Input Limits
 * @description Bounds HTTP parsing and tool validation while preserving managed-file uploads.
 * @logic Allow a 10 MiB file encoded as base64 with JSON overhead and cap aggregate input members before schema validation.
 * @dependencies MCP TypeScript SDK server and HTTP transport
 * @index_tags mcp,security,limits,uploads
 * @author holic512
 */

export const MCP_MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024
export const MCP_MAX_TOOL_INPUT_ELEMENTS = 10_000
