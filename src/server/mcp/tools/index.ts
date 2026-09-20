/**
 * @file index.ts
 * @project SlothVault
 * @module MCP Tool Registry
 * @description Aggregates the MCP 3.0 content-management and safe administrator read-only tool registries.
 * @logic Bind authenticated administrator identity only where authorship is required and keep every tool delegated to established service-layer operations rather than web routes.
 * @dependencies MCP TypeScript SDK, domain tool registries, services/mcp-api-keys
 * @index_tags mcp,tools,registry,administrator,catalog,notes
 * @author holic512
 */
import 'server-only'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { McpPrincipal } from '@/server/services/mcp-api-keys'

import { registerCategoryTools } from './categories'
import { registerFileTools } from './files'
import { registerArticleTools } from './articles'
import { registerAdminReadTools } from './admin-read'
import { registerNoteContentTools } from './note-content'
import { registerNoteTools } from './notes'
import { registerPageTools } from './pages'
import { registerProjectVersionTools } from './project-versions'
import { registerProjectTools } from './projects'

export function registerAdminMcpTools(server: McpServer, principal: McpPrincipal) {
  registerProjectTools(server)
  registerProjectVersionTools(server)
  registerCategoryTools(server)
  registerNoteTools(server, principal)
  registerNoteContentTools(server)
  registerArticleTools(server)
  registerPageTools(server)
  registerFileTools(server)
  registerAdminReadTools(server)
}
