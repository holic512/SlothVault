/**
 * @file server.ts
 * @project SlothVault
 * @module Administrator MCP Server
 * @description Constructs the per-request, stateless SlothVault administrator MCP 5.1 server with daily content tools, safe read tools, protected Resources, and reusable workflows.
 * @logic Bound input elements before tool validation and expose native MCP initialization guidance and versioned registries against one verified principal.
 * @dependencies MCP TypeScript SDK, mcp/tools, mcp/prompts, mcp/resources, services/mcp-api-keys
 * @index_tags mcp,server,streamable-http,administrator,tools,prompts,resources
 * @author holic512
 */
import 'server-only'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { McpPrincipal } from '@/server/services/mcp-api-keys'

import { registerAdminMcpPrompts } from './prompts'
import { MCP_MAX_TOOL_INPUT_ELEMENTS } from './limits'
import { registerAdminMcpResources } from './resources'
import { registerAdminMcpTools } from './tools'

export const ADMIN_MCP_SERVER_NAME = 'slothvault-admin-mcp'
export const ADMIN_MCP_SERVER_VERSION = '5.1.0'
export const ADMIN_MCP_INSTRUCTIONS = 'Use the connected host\'s discovered SlothVault tools and actual schemas. The user\'s task, host approvals, and server permissions govern access. Reuse drafts and attachments. Independent articles use ArticleImage for body images and ArticleAttachment for downloads; project notes use NoteImage and NoteAttachment. Upload all required files successfully before composing or saving bodies. Use returned filePath values for website Markdown URLs; resourceUri is only for MCP reads. Never invent upload URLs or save placeholders. Stop on upload failure; read back uncertain uploads before retrying. Published project-version bodies are frozen: clone to a draft, edit, validate, and publish only when requested. Project documentation uses outline/get_many/apply_draft with stable keys, expected revisions, bounded batches and one changelog. New-version updates clone previous documents first; draft sources need explicit allowDraftSource and expectedSourceRevision. Do not advance a pending baseline before finalize succeeds. Default to drafts, not publication. Article lists contain metadata only; read article details for bodies. Published independent articles remain editable in place. After a failed or uncertain write, read back state before retrying. Protected attachments are MCP Resources; use the website\'s authorized download flow if the host cannot save them.'

export function createAdminMcpServer(principal: McpPrincipal) {
  const server = new McpServer(
    { name: ADMIN_MCP_SERVER_NAME, version: ADMIN_MCP_SERVER_VERSION },
    { capabilities: { logging: {} }, instructions: ADMIN_MCP_INSTRUCTIONS, maxToolInputElements: MCP_MAX_TOOL_INPUT_ELEMENTS },
  )
  registerAdminMcpTools(server, principal)
  registerAdminMcpPrompts(server)
  registerAdminMcpResources(server, principal)
  return server
}
