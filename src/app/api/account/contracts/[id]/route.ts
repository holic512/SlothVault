/**
 * @file route.ts
 * @project SlothVault
 * @module Account Contract Detail API
 * @description Reads a private issued contract for its designated user.
 * @logic Scope reads to the Web2 session and conceal drafts or contracts assigned to any other account.
 * @dependencies user session, HTTP helpers, contracts service
 * @index_tags api,account,contracts,detail,authorization,privacy
 * @author holic512
 */
import { requireUserSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { getUserContract } from '@/server/services/contracts'

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireUserSession(request)
  const { id } = await context.params
  return apiOk(await getUserContract(session.userId, parseBigIntId(id, 'contract id')))
})
