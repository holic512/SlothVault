/**
 * @file route.ts
 * @project SlothVault
 * @module Account Password API
 * @description Changes the current account password and signs out every active session.
 * @logic Delegate current-password or bound-wallet reauthentication to the shared credential service, revoke all sessions, and expire the current cookie.
 * @dependencies zod, session service, user-auth service
 * @index_tags api,account,password,security,logout
 * @author holic512
 */
import { z } from 'zod'

import { clearSessionCookie, requireUserSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson, requestClientIp } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { limitCredentialAttempt } from '@/server/services/credential-rate-limit'
import { reauthenticationSchema } from '@/server/validation/account-security'
import { changeUserPassword } from '@/server/services/user-auth'

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(256).optional(),
  newPassword: z.string().min(8).max(256),
  reauth: reauthenticationSchema.optional(),
})

export const POST = defineRoute(async (request) => {
  const session = await requireUserSession(request)
  const body = await readJson(request, passwordSchema)
  await limitCredentialAttempt(session.userId, requestClientIp(request), body.reauth ?? { method: 'password', password: body.currentPassword ?? '' })
  await changeUserPassword({ userId: session.userId, sessionId: session.id }, body)
  const response = apiOk(null)
  clearSessionCookie(response)
  return response
})
