/**
 * @file server.ts
 * @project SlothVault
 * @module Administrator MCP Server
 * @description Constructs the per-request, stateless SlothVault administrator MCP 3.1 server with daily content tools, safe read tools, protected Resources, and reusable workflows.
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

export const ADMIN_MCP_SERVER_NAME = 'slothvault-admin-mcp'
export const ADMIN_MCP_SERVER_VERSION = '3.1.0'
export const MINIMUM_ADMIN_MCP_CLIENT_VERSION = '1.0.0'

export function createAdminMcpServer(principal: McpPrincipal) {
  const server = new McpServer(
    { name: ADMIN_MCP_SERVER_NAME, version: ADMIN_MCP_SERVER_VERSION },
    { capabilities: { logging: {} } },
  )
  registerAdminMcpTools(server, principal)
  registerAdminMcpPrompts(server)
  registerAdminMcpResources(server, principal)
  return server
}
