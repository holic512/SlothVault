/**
 * @file route.ts
 * @project SlothVault
 * @module Administrator User API
 * @description Lists conventional user accounts for administrator support and point management.
 * @logic Require the administrator role, parse bounded filters, and return profile/role/balance summaries without password or session data.
 * @dependencies admin session, points service
 * @index_tags api,admin,users,points
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { listUsers } from '@/server/services/points'

function bounded(value: string | null, fallback: number, max: number) {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new HttpError('Invalid pagination', 400, 400)
  }
  return parsed
}

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  const query = request.nextUrl.searchParams
  return apiOk(await listUsers({
    page: bounded(query.get('page'), 1, 1_000_000),
    pageSize: bounded(query.get('pageSize'), 20, 100),
    keyword: query.get('keyword') || undefined,
  }))
})
