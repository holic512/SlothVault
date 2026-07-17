import { NextResponse } from 'next/server'

import {
  clearSessionCookie,
  revokeSessionToken,
  SESSION_COOKIE,
} from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'

export const POST = defineRoute(async (request) => {
  await revokeSessionToken(request.cookies.get(SESSION_COOKIE)?.value)
  const response = NextResponse.json({ code: 0, message: 'ok', data: null })
  clearSessionCookie(response)
  return response
})
