/**
 * @file route.ts
 * @project SlothVault
 * @module Account Password API
 * @description Changes the current account password and signs out every active session.
 * @logic Verify the old password, persist a new Argon2id hash in one transaction, revoke sessions, and expire the current cookie.
 * @dependencies zod, session service, user-auth service
 * @index_tags api,account,password,security,logout
 * @author holic512
 */
import { z } from 'zod'

import { clearSessionCookie, requireUserSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { changeUserPassword } from '@/server/services/user-auth'

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(256).optional(),
  newPassword: z.string().min(8).max(256),
})

export const POST = defineRoute(async (request) => {
  const session = await requireUserSession(request)
  const body = await readJson(request, passwordSchema)
  await changeUserPassword(session.userId, body)
  const response = apiOk(null)
  clearSessionCookie(response)
  return response
})
