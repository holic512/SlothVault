/**
 * @file route.ts
 * @project SlothVault
 * @module Account Contracts API
 * @description Lists only contracts assigned to the authenticated user.
 * @logic Require the shared user session, bound pagination, and scope the contract query by the session user ID.
 * @dependencies user session, HTTP helpers, contracts service
 * @index_tags api,account,contracts,list,authorization
 * @author holic512
 */
import { requireUserSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { listUserContracts } from '@/server/services/contracts'

function positiveInt(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value || fallback)
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback
}

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  const session = await requireUserSession(request)
  const query = request.nextUrl.searchParams
  return apiOk(await listUserContracts(session.userId, {
    page: positiveInt(query.get('page'), 1, 100_000),
    pageSize: positiveInt(query.get('pageSize'), 20, 100),
  }))
})
