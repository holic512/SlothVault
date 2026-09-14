/**
 * @file resources.ts
 * @project SlothVault
 * @module MCP Resource Registry
 * @description Reserves a dedicated registration boundary for future administrator MCP resources.
 * @logic Keep Resource registration separate from action-oriented tools so future protected document URIs can reuse the same authenticated MCP principal without changing the transport boundary.
 * @dependencies MCP TypeScript SDK, services/mcp-api-keys
 * @index_tags mcp,resources,registry,extension,administrator
 * @author holic512
 */
import 'server-only'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { McpPrincipal } from '@/server/services/mcp-api-keys'

export function registerAdminMcpResources(server: McpServer, principal: McpPrincipal) {
  void server
  void principal
  // Resources are intentionally introduced after the first Tool contract is stable.
}
