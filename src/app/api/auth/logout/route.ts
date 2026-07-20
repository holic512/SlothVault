/**
 * @file route.ts
 * @project SlothVault
 * @module User Logout API
 * @description Revokes the current shared session and expires its browser cookie.
 * @logic Hash and revoke the presented token when present, then always clear the HTTP-only cookie.
 * @dependencies session service, HTTP response helpers
 * @index_tags api,user,logout,session
 * @author holic512
 */
import { clearSessionCookie, revokeSessionToken, SESSION_COOKIE } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'

export const POST = defineRoute(async (request) => {
  await revokeSessionToken(request.cookies.get(SESSION_COOKIE)?.value)
  const response = apiOk(null)
  clearSessionCookie(response)
  return response
})
