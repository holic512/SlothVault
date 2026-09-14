/**
 * @file route.ts
 * @project SlothVault
 * @module Administrator MCP Key Detail API
 * @description Enables, disables, or permanently deletes one MCP key owned by the current administrator.
 * @logic Require the ordinary administrator session, scope every mutation to its owner, and use a small explicit status contract so disabled keys immediately fail external MCP authentication.
 * @dependencies zod, admin session, HTTP route helpers, admin catalog parsing, services/mcp-api-keys
 * @index_tags api,admin,mcp,api-key,enable,disable,delete,authentication
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { parseDecimalId } from '@/server/services/admin-catalog'
import { MCP_API_KEY_STATUS, deleteMcpApiKey, setMcpApiKeyStatus } from '@/server/services/mcp-api-keys'

const updateMcpApiKeySchema = z.object({
  status: z.union([z.literal(MCP_API_KEY_STATUS.DISABLED), z.literal(MCP_API_KEY_STATUS.ACTIVE)]),
})

export const dynamic = 'force-dynamic'

export const PATCH = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireAdminSession(request)
  const { id } = await context.params
  const body = await readJson(request, updateMcpApiKeySchema)
  return apiOk(await setMcpApiKeyStatus({
    userId: session.User.id,
    apiKeyId: parseDecimalId(id),
    status: body.status,
  }))
})

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireAdminSession(request)
  const { id } = await context.params
  await deleteMcpApiKey({ userId: session.User.id, apiKeyId: parseDecimalId(id) })
  return apiOk(null, 'deleted')
})
