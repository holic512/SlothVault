/**
 * @file route.ts
 * @project SlothVault
 * @module Administrator MCP Key Collection API
 * @description Lists the current administrator's MCP keys and creates one newly revealed administrator MCP key.
 * @logic Require the ordinary administrator session for management actions, validate a bounded key label and optional future expiry, and reveal the generated secret only in the creation response.
 * @dependencies zod, admin session, HTTP route helpers, services/mcp-api-keys
 * @index_tags api,admin,mcp,api-key,create,list,authentication
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { createMcpApiKey, listMcpApiKeys } from '@/server/services/mcp-api-keys'

const createMcpApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  expiresAt: z.string().datetime().nullable().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  return apiOk(await listMcpApiKeys(session.User.id))
})

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  const body = await readJson(request, createMcpApiKeySchema)
  const expiresAt = body.expiresAt === undefined || body.expiresAt === null
    ? null
    : new Date(body.expiresAt)
  return apiOk(await createMcpApiKey({
    userId: session.User.id,
    name: body.name,
    expiresAt,
  }), 'created', 201)
})
