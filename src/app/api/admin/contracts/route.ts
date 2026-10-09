/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Contracts API
 * @description Lists read-only legacy contracts for retained history.
 * @logic Require an administrator and bound history filters before reading retained contracts.
 * @dependencies admin session, HTTP helpers, contracts service
 * @index_tags api,admin,contracts,list,create
 * @author holic512
 */

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { listAdminContracts } from '@/server/services/contracts'

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
