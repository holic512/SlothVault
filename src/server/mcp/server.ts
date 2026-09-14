/**
 * @file server.ts
 * @project SlothVault
 * @module Administrator MCP Server
 * @description Constructs a per-request, stateless MCP server for an authenticated SlothVault administrator.
 * @logic Register the server identity plus isolated Tool and Resource registries against one verified MCP principal, keeping future protocol capabilities independent from browser route handlers.
 * @dependencies MCP TypeScript SDK, mcp/tools, mcp/resources, services/mcp-api-keys
 * @index_tags mcp,server,streamable-http,administrator,tools,resources
 * @author holic512
 */
import 'server-only'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { McpPrincipal } from '@/server/services/mcp-api-keys'

import { registerAdminMcpResources } from './resources'
import { registerAdminMcpTools } from './tools'

export function createAdminMcpServer(principal: McpPrincipal) {
  const server = new McpServer(
    { name: 'slothvault-admin-mcp', version: '1.0.0' },
    { capabilities: { logging: {} } },
  )
  registerAdminMcpTools(server, principal)
  registerAdminMcpResources(server, principal)
  return server
}
