/**
 * @file index.ts
 * @project SlothVault
 * @module MCP Tool Registry
 * @description Registers the first administrator MCP tools and provides one expansion point for future project, version, category, and note tools.
 * @logic Bind each exposed tool to the authenticated MCP principal and delegate directly to established service-layer operations instead of calling web route handlers or duplicating business rules.
 * @dependencies MCP TypeScript SDK, zod, services/admin-catalog/projects, services/mcp-api-keys
 * @index_tags mcp,tools,registry,administrator,projects,service-layer
 * @author holic512
 */
import 'server-only'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { toJsonSafe } from '@/server/http/response'
import type { McpPrincipal } from '@/server/services/mcp-api-keys'
import { listAdminProjects } from '@/server/services/admin-catalog/projects'

function jsonToolResult(value: unknown) {
  const safe = toJsonSafe(value)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(safe) }],
    structuredContent: safe as Record<string, unknown>,
  }
}

export function registerAdminMcpTools(server: McpServer, principal: McpPrincipal) {
  void principal
  server.registerTool(
    'admin_project_list',
    {
      title: '列出管理员项目',
      description: '分页读取当前 SlothVault 管理员可管理的项目。该工具只读，不会创建、发布、修改或删除项目。',
      inputSchema: {
        page: z.number().int().min(1).max(10_000).default(1)
          .describe('从 1 开始的页码。'),
        pageSize: z.number().int().min(1).max(50).default(20)
          .describe('每页项目数量，最多 50。'),
        keyword: z.string().max(120).default('')
          .describe('可选的项目名称关键字。'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ page, pageSize, keyword }) => jsonToolResult(await listAdminProjects({
      page,
      pageSize,
      skip: (page - 1) * pageSize,
      keyword: keyword.trim(),
      includeDeleted: false,
      onlyDeleted: false,
      status: undefined,
      orderByField: 'updatedAt',
      order: 'desc',
    })),
  )
}
