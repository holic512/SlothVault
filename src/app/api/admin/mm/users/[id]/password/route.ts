/**
 * @file route.ts
 * @project SlothVault
 * @module Administrator User Password API
 * @description Resets one managed account password and revokes that account's active sessions.
 * @logic Require an administrator session, validate the replacement password, revoke every target session after changing its Argon2id hash, and sign out the administrator when resetting their own password.
 * @dependencies zod, admin session, HTTP route helpers, admin-users service
 * @index_tags api,admin,user,password,reset,session
 * @author holic512
 */
import { z } from 'zod'

import { clearSessionCookie, requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { parseDecimalId } from '@/server/services/admin-catalog'
import { resetManagedUserPassword } from '@/server/services/admin-users'

const resetPasswordSchema = z.object({
  password: z.string().min(8).max(256),
})

export const POST = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const userId = parseDecimalId(idRaw)
  const { password } = await readJson(request, resetPasswordSchema)
  await resetManagedUserPassword({ userId, password })

  const signedOut = session.userId === userId
  const response = apiOk({ signedOut })
  if (signedOut) clearSessionCookie(response)
  return response
})
