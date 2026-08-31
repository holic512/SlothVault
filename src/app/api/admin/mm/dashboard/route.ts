/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Dashboard API
 * @description Returns the administration dashboard overview, selectable UTC trends, health metrics, and privacy-safe recent activity.
 * @logic Authenticate the request, validate the requested trend window, delegate metric aggregation to the dashboard service, and wrap the stable API response.
 * @dependencies admin session, server/http helpers, admin dashboard service
 * @index_tags api,admin,dashboard,metrics
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { getAdminDashboard, isAdminDashboardRange } from '@/server/services/admin-dashboard'

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  const rawRange = request.nextUrl.searchParams.get('range')
  const range = rawRange === null ? 30 : Number(rawRange)
  if (!Number.isInteger(range) || !isAdminDashboardRange(range)) {
    throw new HttpError('Invalid dashboard range', 400, 400)
  }
  return apiOk(await getAdminDashboard({ range }))
})
