/**
 * @file route.ts
 * @project SlothVault
 * @module Account Deletion Preview API
 * @description Returns protected customer relationships and the account deletion impact for administrator review.
 * @logic Require an administrator session and delegate authoritative preview checks to the account service.
 * @dependencies admin session, admin-users service, route helpers
 * @index_tags api,users,deletion,preview
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { parseDecimalId } from '@/server/services/admin-catalog'
import { previewManagedUserDeletion } from '@/server/services/admin-users'
export const GET = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireAdminSession(request)
  const { id } = await context.params
  return apiOk(await previewManagedUserDeletion({ actorUserId: session.userId, userId: parseDecimalId(id) }))
})
