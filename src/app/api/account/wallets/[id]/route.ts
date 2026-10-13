/**
 * @file route.ts
 * @project SlothVault
 * @module Personal Account Security API
 * @description Exposes authenticated, operation-bound credential management.
 * @logic Require the ordinary session, validate and limit proofs, then delegate atomic credential changes.
 * @dependencies account-security services, session, validation
 * @index_tags api,account,wallet,credentials,reauthentication
 * @author holic512
 */
import { requireUserSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson, requestClientIp } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { limitCredentialAttempt } from '@/server/services/credential-rate-limit'
import { z } from 'zod'
import { mutateAccountWallet } from '@/server/services/account-security'
import { reauthenticationSchema, walletIdSchema } from '@/server/validation/account-security'
export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireUserSession(request), walletId = walletIdSchema.parse((await context.params).id)
  const body = await readJson(request, z.object({ reauth: reauthenticationSchema }).strict())
  await limitCredentialAttempt(session.userId, requestClientIp(request), body.reauth)
  return apiOk(await mutateAccountWallet({ userId: session.userId, sessionId: session.id }, { target: { action: 'unbind', walletId }, reauth: body.reauth }))
})
