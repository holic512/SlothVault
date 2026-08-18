/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Contracts API
 * @description Lists administrator-visible contracts and creates editable one-to-one contract drafts.
 * @logic Require an administrator, bound list inputs, and delegate draft persistence to the contract domain service.
 * @dependencies zod, admin session, HTTP helpers, contracts service
 * @index_tags api,admin,contracts,list,create
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { createAdminContract, listAdminContracts } from '@/server/services/contracts'

const contractSchema = z.object({
  subjectUserId: z.coerce.number().int().positive(),
  title: z.string().min(1).max(255),
  body: z.string().min(1).max(100_000),
  attachmentFileId: z.coerce.number().int().positive().nullable().optional(),
})

function positiveInt(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value || fallback)
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback
}

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  const query = request.nextUrl.searchParams
  const statusRaw = query.get('status')
  const status = statusRaw === null || statusRaw === '' ? undefined : Number(statusRaw)
  return apiOk(await listAdminContracts({
    page: positiveInt(query.get('page'), 1, 100_000),
    pageSize: positiveInt(query.get('pageSize'), 20, 100),
    keyword: query.get('keyword')?.trim() || undefined,
    status: Number.isInteger(status) ? status : undefined,
  }))
})

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  const body = await readJson(request, contractSchema, { maxBytes: 150_000 })
  return apiOk(await createAdminContract({ ...body, issuerUserId: session.User.id }), 'created', 201)
})
