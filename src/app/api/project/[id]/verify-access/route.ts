/**
 * @file route.ts
 * @project SlothVault
 * @module Project Capability API
 * @description Reports independent reading and download decisions while preserving the legacy hasAccess field.
 * @logic Read current policy and session memberships on every request and return reasons without shared caching.
 * @dependencies HTTP route helpers, content-access, viewer
 * @index_tags api,compatibility,reading,download,membership
 * @author holic512
 */
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { resolveProjectAccess } from '@/server/services/content-access'
import { getRequestViewer } from '@/server/auth/viewer'

export const POST = defineRoute<{ id: string }>(async (request, context) => {
  const { id } = await context.params
  const projectId = parseBigIntId(id, 'project id')
  const access = await resolveProjectAccess(projectId, await getRequestViewer(request))
  const response = apiOk({
    ...access,
    hasAccess: access.canRead,
    reason: access.readReason,
    requireAuth: access.readAccess.mode !== 'PUBLIC',
  })
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}, { cacheControl: 'private, no-store' })
