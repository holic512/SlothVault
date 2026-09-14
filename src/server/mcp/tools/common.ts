/**
 * @file common.ts
 * @project SlothVault
 * @module MCP Tool Contracts
 * @description Defines shared validation, output serialization, annotations, and safe error mapping for administrator MCP tools.
 * @logic Validate stable decimal identifiers and bounded primitives, serialize service DTOs for MCP structured output, and expose only actionable HttpError details while hiding unexpected internals.
 * @dependencies MCP TypeScript SDK, zod, server/http, admin catalog values
 * @index_tags mcp,tools,validation,output,error,annotations
 * @author holic512
 */
import 'server-only'

import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { HttpError } from '@/server/http/errors'
import { toJsonSafe } from '@/server/http/response'
import { parseJsonDecimalId } from '@/server/services/admin-catalog'

const MAX_DATABASE_ID = 2_147_483_647
const MIN_DATABASE_INTEGER = -2_147_483_648

export const decimalIdSchema = z.string()
  .regex(/^\d+$/, '必须是正十进制字符串。')
  .refine((value) => {
    const id = Number(value)
    return Number.isSafeInteger(id) && id >= 1 && id <= MAX_DATABASE_ID
  }, 'ID 超出数据库允许范围。')

export const databaseIntegerSchema = z.number().int()
  .min(MIN_DATABASE_INTEGER)
  .max(MAX_DATABASE_ID)

export const statusSchema = z.union([z.literal(0), z.literal(1)])
export const orderSchema = z.enum(['asc', 'desc']).default('desc')
export const pageSchema = z.number().int().min(1).max(10_000).default(1)
export const pageSizeSchema = z.number().int().min(1).max(50).default(20)
export const isoDateSchema = z.iso.datetime()

export const paginationOutputShape = {
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
}

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} satisfies ToolAnnotations

export const CREATE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} satisfies ToolAnnotations

export const UPDATE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} satisfies ToolAnnotations

export function mcpId(value: string, label: string) {
  return parseJsonDecimalId(value, label)
}

function safeHttpErrorData(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const record = data as Record<string, unknown>
  const safe: Record<string, unknown> = {}
  if (typeof record.reason === 'string') safe.reason = record.reason
  for (const key of ['projectId', 'projectVersionId'] as const) {
    if (typeof record[key] === 'string') safe[key] = record[key]
  }
  if (Array.isArray(record.issues)) {
    safe.issues = record.issues.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const issue = item as Record<string, unknown>
      if (
        typeof issue.code !== 'string' ||
        typeof issue.entity !== 'string' ||
        typeof issue.entityId !== 'string' ||
        typeof issue.message !== 'string'
      ) return []
      return [{
        code: issue.code,
        entity: issue.entity,
        entityId: issue.entityId,
        message: issue.message,
      }]
    })
  }
  return Object.keys(safe).length > 0 ? safe : null
}

function errorToolResult(error: unknown, toolName: string): CallToolResult {
  if (error instanceof HttpError) {
    const failure = {
      error: {
        status: error.status,
        code: error.code,
        message: error.message,
        data: safeHttpErrorData(error.data),
      },
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(failure) }],
      structuredContent: failure,
      isError: true,
    }
  }

  console.error(`[mcp:${toolName}] Tool execution failed`, error)
  const failure = {
    error: {
      status: 500,
      code: 500,
      message: 'Internal server error',
      data: null,
    },
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(failure) }],
    structuredContent: failure,
    isError: true,
  }
}

export async function runMcpTool(
  toolName: string,
  operation: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  try {
    const safe = toJsonSafe(await operation())
    return {
      content: [{ type: 'text', text: JSON.stringify(safe) }],
      structuredContent: safe,
    }
  } catch (error) {
    return errorToolResult(error, toolName)
  }
}
