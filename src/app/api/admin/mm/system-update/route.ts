/**
 * @file route.ts
 * @project SlothVault
 * @module Admin System Update API
 * @description Returns the running application release identity and its public GitHub Release update status.
 * @logic Authenticate an administrator, delegate only to the read-only update service, and return displayable remote-check failures in the normal API envelope.
 * @dependencies admin session, server/http helpers, system update service
 * @index_tags api,admin,system-update,release,github
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { getSystemUpdateInfo } from '@/server/services/system-update'

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  return apiOk(await getSystemUpdateInfo())
})
