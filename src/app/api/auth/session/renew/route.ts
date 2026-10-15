/**
 * @file route.ts
 * @project SlothVault
 * @module Session Renewal API
 * @description Renews an active browser session without resetting its authentication time.
 * @logic Require same-origin activity, bound input and request rate, atomically extend eligible sessions, and return non-secret lifecycle metadata.
 * @dependencies auth/session, HTTP helpers, short-lived-state, user-auth DTO
 * @index_tags auth,session,renewal,csrf
 * @author holic512
 */
import { z } from 'zod'
import { clearSessionCookie, renewSessionToken, readSession, SESSION_COOKIE, sessionAbsoluteExpiresAt } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { HttpError } from '@/server/http/errors'
import { readJson, requestClientIp } from '@/server/http/request'
import { apiFail, apiOk } from '@/server/http/response'
import { isSameOriginRequest } from '@/server/http/same-origin'
import { userDto } from '@/server/services/user-auth'
import { enforceRateLimit } from '@/server/short-lived-state'

export const POST = defineRoute(async (request) => {
  if (!isSameOriginRequest(request)) throw new HttpError('Cross-origin renewal is not allowed', 403, 403)
  await enforceRateLimit({ scope: 'session-renew-ip', identity: requestClientIp(request), limit: 120, windowSeconds: 60 })
  await readJson(request, z.object({}).strict(), { maxBytes: 1024 })
  const existing = await readSession(request)
  if (existing) {
    await enforceRateLimit({ scope: 'session-renew', identity: existing.id, limit: 60, windowSeconds: 5 * 60 })
  }
  const session = existing ? await renewSessionToken(request.cookies.get(SESSION_COOKIE)?.value) : null
  if (!session) {
    const response = apiFail('Unauthorized', 401, 401)
    clearSessionCookie(response)
    return response
  }
  return apiOk({
    user: userDto(session.User),
    expiresAt: session.expiresAt,
    absoluteExpiresAt: sessionAbsoluteExpiresAt(session),
    persistent: session.persistent,
  })
})
