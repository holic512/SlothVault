/**
 * @file route.ts
 * @project SlothVault
 * @module Account Contract Signature API
 * @description Records an authenticated Web2 acceptance for the session user's frozen contract.
 * @logic Bind the current server session and request audit metadata to the one eligible pending contract, then calculate its immutable root hash.
 * @dependencies user session, request IP helper, HTTP helpers, contracts service
 * @index_tags api,account,contracts,sign,web2,audit
 * @author holic512
 */
import { requireUserSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId, requestClientIp } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { signUserContract } from '@/server/services/contracts'

export const dynamic = 'force-dynamic'

export const POST = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireUserSession(request)
  const { id } = await context.params
  return apiOk(await signUserContract({
    id: parseBigIntId(id, 'contract id'),
    userId: session.User.id,
    sessionId: session.id,
    ip: requestClientIp(request),
    userAgent: request.headers.get('user-agent'),
  }))
})
