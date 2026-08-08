/**
 * @file route.ts
 * @project SlothVault
 * @module User Login API
 * @description Authenticates a username/email and password for any active personal or administrator account.
 * @logic Rate-limit attempts, validate credentials through the shared identity service, and attach the returned HTTP-only session cookie.
 * @dependencies zod, user-auth service, session cookie, in-memory rate limit
 * @index_tags api,user,login,password,session
 * @author holic512
 */
import { z } from 'zod'

import { setSessionCookie } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson, requestClientIp } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { enforceRateLimit } from '@/server/short-lived-state'
import { loginUser } from '@/server/services/user-auth'

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(256),
  remember: z.boolean().optional().default(false),
})

export const POST = defineRoute(async (request) => {
  const ip = requestClientIp(request)
  await enforceRateLimit({ scope: 'login', identity: ip, limit: 12, windowSeconds: 15 * 60 })
  const body = await readJson(request, loginSchema)
  const result = await loginUser({
    ...body,
    ip,
    userAgent: request.headers.get('user-agent'),
  })
  const response = apiOk(result.user)
  setSessionCookie(response, result.session.token, result.session.expiresAt)
  return response
})
