/**
 * @file route.ts
 * @project SlothVault
 * @module Wallet Login Verification API
 * @description Verifies a one-time wallet signature and establishes the ordinary SlothVault user session.
 * @logic Consume the Redis challenge, verify Ed25519 ownership, bind/provision the account, and set the shared HTTP-only cookie.
 * @dependencies zod, wallet-auth service, session cookie, Redis rate limit
 * @index_tags api,wallet,login,verification,session
 * @author holic512
 */
import { z } from 'zod'

import { setSessionCookie } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson, requestClientIp } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { enforceRateLimit } from '@/server/redis'
import { verifyWalletLogin } from '@/server/services/wallet-auth'

const verifySchema = z.object({
  challengeId: z.string().uuid(),
  address: z.string().trim().min(32).max(64),
  signature: z.string().trim().min(64).max(256),
})

export const POST = defineRoute(async (request) => {
  const ip = requestClientIp(request)
  await enforceRateLimit({ scope: 'wallet-verify', identity: ip, limit: 16, windowSeconds: 15 * 60 })
  const body = await readJson(request, verifySchema)
  const result = await verifyWalletLogin({
    ...body,
    ip,
    userAgent: request.headers.get('user-agent'),
  })
  const response = apiOk(result.user)
  setSessionCookie(response, result.session.token, result.session.expiresAt)
  return response
})
