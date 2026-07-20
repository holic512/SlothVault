/**
 * @file route.ts
 * @project SlothVault
 * @module Account Points API
 * @description Returns the current user's authoritative point balance and immutable transaction history.
 * @logic Require a user session, parse bounded pagination, and read the balance and ledger from the database.
 * @dependencies session service, points service
 * @index_tags api,account,points,ledger
 * @author holic512
 */
import { requireUserSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { listUserPointTransactions } from '@/server/services/points'

function pageValue(value: string | null, fallback: number, max: number) {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new HttpError('Invalid pagination', 400, 400)
  }
  return parsed
}

export const GET = defineRoute(async (request) => {
  const session = await requireUserSession(request)
  const query = request.nextUrl.searchParams
  return apiOk(await listUserPointTransactions(
    session.userId,
    pageValue(query.get('page'), 1, 1_000_000),
    pageValue(query.get('pageSize'), 20, 100),
  ))
})
