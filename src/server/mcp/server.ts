/**
 * @file server.ts
 * @project SlothVault
 * @module Administrator MCP Server
 * @description Constructs the per-request, stateless SlothVault administrator MCP 5.0 server with daily content tools, safe read tools, protected Resources, and reusable workflows.
 * @logic Expose native MCP initialization guidance and the versioned Tool, Prompt, and Resource registries against one verified principal, without a dedicated-client version policy.
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
export const ADMIN_MCP_SERVER_VERSION = '5.0.0'
export const ADMIN_MCP_INSTRUCTIONS = 'Use the connected host\'s discovered SlothVault tools and actual schemas. The user\'s task, host approvals, and server permissions govern access. Reuse drafts and attachments. Published project-version bodies are frozen: clone to a draft, edit, validate, and publish only when requested. Article lists contain metadata only; read article details for bodies. Published independent articles remain editable in place. After a failed or uncertain write, read back state before retrying. Protected attachments are MCP Resources; use the website\'s authorized download flow if the host cannot save them.'

export function createAdminMcpServer(principal: McpPrincipal) {
  const server = new McpServer(
    { name: ADMIN_MCP_SERVER_NAME, version: ADMIN_MCP_SERVER_VERSION },
    { capabilities: { logging: {} }, instructions: ADMIN_MCP_INSTRUCTIONS },
  )
  registerAdminMcpTools(server, principal)
  registerAdminMcpPrompts(server)
  registerAdminMcpResources(server, principal)
  return server
}
