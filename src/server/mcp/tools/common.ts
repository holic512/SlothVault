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
import { z, type ZodType } from 'zod'

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
export const mcpIdSchema = decimalIdSchema
export const moneySchema = z.string().regex(/^-?\d+(?:\.\d{1,2})?$/, '金额必须是最多两位小数的十进制字符串。')

export const statusSchema = z.union([z.literal(0), z.literal(1)])
export const orderSchema = z.enum(['asc', 'desc']).default('desc')
export const pageSchema = z.number().int().min(1).max(10_000).default(1)
export const pageSizeSchema = z.number().int().min(1).max(50).default(20)
export const isoDateSchema = z.iso.datetime()
export const jsonObjectSchema = z.object({}).passthrough()

export const MCP_SENSITIVE_FIELD_NAMES = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'sessionToken',
  'sessionId',
  'secret',
  'secretHash',
  'apiKey',
  'apiKeyHash',
  'codeHash',
  'privateKey',
  'mnemonic',
  'rawKey',
  'ip',
  'userAgent',
] as const
const SENSITIVE_FIELD_NAMES = new Set<string>(MCP_SENSITIVE_FIELD_NAMES)

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

export const paginationInputSchema = z.strictObject({ page: pageSchema, pageSize: pageSizeSchema })
export const mcpErrorSchema = z.object({
  error: z.object({
    status: z.number().int(),
    code: z.number().int(),
    message: z.string(),
    data: z.unknown().nullable(),
  }),
})

/** Builds the canonical paginated list response schema for one public DTO. */
export function paginatedListSchema<T extends ZodType>(itemSchema: T) {
  return z.object({ list: z.array(itemSchema), ...paginationOutputShape })
}

/** Removes credentials and private key material from values before MCP serialization. */
export function redactMcpSensitiveFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactMcpSensitiveFields) as unknown as T
  if (!value || typeof value !== 'object') return value
  if (value instanceof Date) return value
  const redacted: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_FIELD_NAMES.has(key)) continue
    redacted[key] = /(?:^id$|Id$)/.test(key) &&
      (typeof item === 'number' || typeof item === 'bigint')
      ? item.toString()
      : redactMcpSensitiveFields(item)
  }
  return redacted as unknown as T
}

/** Selects only documented conflict details from an HttpError payload. */
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

export function mcpErrorResult(error: unknown, toolName: string): CallToolResult {
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
    const safe = toJsonSafe(redactMcpSensitiveFields(await operation()))
    return {
      content: [{ type: 'text', text: JSON.stringify(safe) }],
      structuredContent: safe,
    }
  } catch (error) {
    return mcpErrorResult(error, toolName)
  }
}
