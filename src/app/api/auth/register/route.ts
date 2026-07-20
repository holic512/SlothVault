/**
 * @file route.ts
 * @project SlothVault
 * @module User Registration API
 * @description Creates a conventional personal account and establishes the shared HTTP-only session.
 * @logic Rate-limit by client address, validate normalized profile credentials, persist the user, and issue the same session used by wallet login.
 * @dependencies zod, user-auth service, session service, Redis rate limit
 * @index_tags api,user,registration,session,rate-limit
 * @author holic512
 */
import { z } from 'zod'

import { issueSession, setSessionCookie } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson, requestClientIp } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { enforceRateLimit } from '@/server/redis'
import { registerUser } from '@/server/services/user-auth'

const registerSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_]+$/),
  email: z.string().trim().email().max(255).optional(),
  password: z.string().min(8).max(256),
  displayName: z.string().trim().max(80).optional(),
})

export const POST = defineRoute(async (request) => {
  const ip = requestClientIp(request)
  await enforceRateLimit({ scope: 'register', identity: ip, limit: 8, windowSeconds: 60 * 60 })
  const body = await readJson(request, registerSchema)
  const result = await registerUser(body)
  const session = await issueSession({
    userId: result.userId,
    ip,
    userAgent: request.headers.get('user-agent'),
  })
  const response = apiOk(result.user, 'created', 201)
  setSessionCookie(response, session.token, session.expiresAt)
  return response
})
