/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Authentication API
 * @description Authenticates an administrator and establishes the secure session cookie.
 * @logic Validate credentials, collect request metadata, delegate credential/session persistence, and attach the returned token as a cookie.
 * @dependencies zod, server/auth/session cookie helper, server/http helpers, admin authentication service
 * @index_tags api,admin,authentication,login,session-cookie
 * @author holic512
 */
import { z } from 'zod'

import { setSessionCookie } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { loginAdmin } from '@/server/services/admin-auth'

const loginSchema = z.object({
  username: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(256),
  remember: z.boolean().optional().default(false),
})

export const POST = defineRoute(async (request) => {
  const body = await readJson(request, loginSchema)
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const result = await loginAdmin({
    ...body,
    ip: forwardedFor || request.headers.get('x-real-ip'),
    userAgent: request.headers.get('user-agent'),
  })
  const response = apiOk(result.user)
  setSessionCookie(response, result.session.token, result.session.expiresAt)
  return response
})
