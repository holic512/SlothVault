/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Contract Detail API
 * @description Reads or updates one administrator-managed contract draft.
 * @logic Require an administrator, parse a bounded identifier, and keep edits inside the draft-only service invariant.
 * @dependencies zod, admin session, HTTP helpers, contracts service
 * @index_tags api,admin,contracts,detail,update
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId, readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { getAdminContract, updateAdminContract } from '@/server/services/contracts'

const schema = z.object({
  subjectUserId: z.coerce.number().int().positive(),
  title: z.string().min(1).max(255),
  body: z.string().min(1).max(100_000),
  attachmentFileId: z.coerce.number().int().positive().nullable().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id } = await context.params
  return apiOk(await getAdminContract(parseBigIntId(id, 'contract id')))
})

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireAdminSession(request)
  const { id } = await context.params
  const body = await readJson(request, schema, { maxBytes: 150_000 })
  return apiOk(await updateAdminContract({
    ...body,
    id: parseBigIntId(id, 'contract id'),
    issuerUserId: session.User.id,
  }))
})
