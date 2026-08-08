/**
 * @file route.ts
 * @project SlothVault
 * @module Wallet Login Challenge API
 * @description Creates a one-time process-memory message for optional wallet login or account binding.
 * @logic Rate-limit by client address, attach the current user when present, and return a five-minute canonical signing message.
 * @dependencies zod, session service, wallet-auth service, in-memory rate limit
 * @index_tags api,wallet,login,binding,challenge
 * @author holic512
 */
import { z } from 'zod'

import { readSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson, requestClientIp } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { enforceRateLimit } from '@/server/short-lived-state'
import { createWalletLoginChallenge } from '@/server/services/wallet-auth'

const challengeSchema = z.object({
  address: z.string().trim().min(32).max(64),
})

export const POST = defineRoute(async (request) => {
  const ip = requestClientIp(request)
  await enforceRateLimit({ scope: 'wallet-challenge', identity: ip, limit: 20, windowSeconds: 15 * 60 })
  const body = await readJson(request, challengeSchema)
  const session = await readSession(request)
  return apiOk(await createWalletLoginChallenge({ address: body.address, userId: session?.userId }))
})
