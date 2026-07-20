/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Dashboard API
 * @description Returns the administration dashboard overview, health metrics, and recent activity.
 * @logic Authenticate the request, delegate metric aggregation to the dashboard service, and wrap the stable API response.
 * @dependencies admin session, server/http helpers, admin dashboard service
 * @index_tags api,admin,dashboard,metrics
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { getAdminDashboard } from '@/server/services/admin-dashboard'

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  return apiOk(await getAdminDashboard())
})
