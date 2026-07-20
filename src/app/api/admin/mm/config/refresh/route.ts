/**
 * @file route.ts
 * @project SlothVault
 * @module Admin System Configuration API
 * @description Verifies configuration storage availability for the process-independent Next.js runtime.
 * @logic Authenticate, delegate the storage probe to the settings service, and wrap its compatibility response.
 * @dependencies admin session, server/http helpers, admin settings service
 * @index_tags api,admin,settings,refresh,database
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { refreshAdminSettings } from '@/server/services/admin-settings'

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  return apiOk(await refreshAdminSettings())
})
