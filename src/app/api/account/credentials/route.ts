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
import { clearSessionCookie } from '@/server/auth/session'
import { getAccountCredentials, updateAccountCredentials } from '@/server/services/account-security'
import { credentialsSchema } from '@/server/validation/account-security'
export const GET = defineRoute(async request => { const session = await requireUserSession(request); return apiOk(await getAccountCredentials(session.userId)) })
export const PATCH = defineRoute(async request => {
  const session = await requireUserSession(request), body = await readJson(request, credentialsSchema)
  await limitCredentialAttempt(session.userId, requestClientIp(request), body.reauth)
  const result = await updateAccountCredentials({ userId: session.userId, sessionId: session.id }, body)
  const response = apiOk(result)
  if (result.passwordChanged) clearSessionCookie(response)
  return response
})
