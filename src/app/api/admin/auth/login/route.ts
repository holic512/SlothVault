import { z } from 'zod'

import { issueSession, setSessionCookie } from '@/server/auth/session'
import { verifyPassword } from '@/server/auth/password'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'

const loginSchema = z.object({
  username: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(256),
  remember: z.boolean().optional().default(false),
})

export const POST = defineRoute(async (request) => {
  const body = await readJson(request, loginSchema)
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: body.username }, { email: body.username }] },
  })

  if (!user || !(await verifyPassword(user.password, body.password))) {
    throw new HttpError('Invalid credentials', 401, 401)
  }

  const ttlMs = (body.remember ? 30 : 7) * 24 * 60 * 60 * 1000
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const session = await issueSession({
    userId: user.id,
    ttlMs,
    ip: forwardedFor || request.headers.get('x-real-ip'),
    userAgent: request.headers.get('user-agent'),
  })
  const response = apiOk({ id: user.id, username: user.username })
  setSessionCookie(response, session.token, session.expiresAt)
  return response
})
