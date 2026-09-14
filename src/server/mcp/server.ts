/**
 * @file server.ts
 * @project SlothVault
 * @module Administrator MCP Server
 * @description Constructs the per-request, stateless SlothVault administrator MCP server with draft-management tools and reusable workflows.
 * @logic Register the versioned server identity plus isolated Tool, Prompt, and Resource registries against one verified MCP principal while keeping protocol capabilities independent from browser routes.
 * @dependencies MCP TypeScript SDK, mcp/tools, mcp/prompts, mcp/resources, services/mcp-api-keys
 * @index_tags mcp,server,streamable-http,administrator,tools,prompts,resources
 * @author holic512
 */
import 'server-only'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { McpPrincipal } from '@/server/services/mcp-api-keys'

import { registerAdminMcpPrompts } from './prompts'
import { registerAdminMcpResources } from './resources'
import { registerAdminMcpTools } from './tools'

export function createAdminMcpServer(principal: McpPrincipal) {
  const server = new McpServer(
    { name: 'slothvault-admin-mcp', version: '2.0.0' },
    { capabilities: { logging: {} } },
  )
  registerAdminMcpTools(server, principal)
  registerAdminMcpPrompts(server)
  registerAdminMcpResources(server, principal)
  return server
}
