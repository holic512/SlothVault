/**
 * @file route.ts
 * @project SlothVault
 * @module Wallet Login Challenge API
 * @description Creates a five-minute, one-time message for explicitly declared login or personal credential authorization.
 * @logic Validate an explicit purpose, require an active session for mutations, and return a five-minute operation-bound signing message.
 * @dependencies wallet challenge validation, session service, wallet-auth service, short-lived state rate limit
 * @index_tags api,wallet,login,binding,challenge
 * @author holic512
 */
import { requireUserSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson, requestClientIp } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { enforceRateLimit } from '@/server/short-lived-state'
import { createWalletLoginChallenge } from '@/server/services/wallet-auth'

import { walletChallengeSchema } from '@/server/validation/account-security'

export const POST = defineRoute(async (request) => {
  const ip = requestClientIp(request)
  await enforceRateLimit({ scope: 'wallet-challenge', identity: ip, limit: 20, windowSeconds: 15 * 60 })
  const body = await readJson(request, walletChallengeSchema)
  if (body.purpose === 'login') return apiOk(await createWalletLoginChallenge(body))
  const session = await requireUserSession(request)
  return apiOk(await createWalletLoginChallenge({ ...body, context: { userId: session.userId, sessionId: session.id } }))
})
