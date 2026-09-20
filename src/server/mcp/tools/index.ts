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

import type { McpPrincipal } from '@/server/services/mcp-api-keys'
import { registerMcpToolDefinitions, type McpToolDefinition } from '@/server/mcp/registry'

import { categoryToolDefinitions } from './categories'
import { fileToolDefinitions } from './files'
import { articleToolDefinitions } from './articles'
import { adminReadToolDefinitions } from './admin-read'
import { noteContentToolDefinitions } from './note-content'
import { noteToolDefinitions } from './notes'
import { pageToolDefinitions } from './pages'
import { projectVersionToolDefinitions } from './project-versions'
import { projectToolDefinitions } from './projects'

/** Contains the complete administrator Tool declaration list. */
export const adminMcpToolDefinitions: McpToolDefinition[] = [
  ...projectToolDefinitions,
  ...projectVersionToolDefinitions,
  ...categoryToolDefinitions,
  ...noteToolDefinitions,
  ...noteContentToolDefinitions,
  ...articleToolDefinitions,
  ...pageToolDefinitions,
  ...fileToolDefinitions,
  ...adminReadToolDefinitions,
]

/** Registers every administrator Tool through the single declaration adapter. */
export function registerAdminMcpTools(server: Parameters<typeof registerMcpToolDefinitions>[0], principal: McpPrincipal) {
  registerMcpToolDefinitions(server, adminMcpToolDefinitions, principal)
}
