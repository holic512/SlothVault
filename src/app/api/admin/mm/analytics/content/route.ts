/**
 * @file route.ts
 * @project SlothVault
 * @module Telemetry Administration API
 * @description Returns authenticated, bounded instance telemetry without changing the legacy dashboard.
 * @logic Require the existing administrator session, validate filters and query the isolated statistics worker.
 * @dependencies admin session, HTTP helpers, telemetry dashboard service
 * @index_tags api,admin,telemetry
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { readTelemetryDashboard } from '@/server/telemetry/dashboard'
export const dynamic = 'force-dynamic'
export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  return apiOk(await readTelemetryDashboard(request, 'content'))
}, { cacheControl: 'private, no-store', lockMode: 'none' })
