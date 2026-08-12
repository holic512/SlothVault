/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Version Integrity API
 * @description Rebuilds and verifies one published version manifest.
 * @logic Authenticate the administrator, rebuild canonical bytes, and return stored/computed hash evidence without exposing internal byte buffers.
 * @dependencies admin session, HTTP route helpers, project-version release service
 * @index_tags api,admin,project-version,integrity,sha256
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { parseDecimalId } from '@/server/services/admin-catalog'
import { getProjectVersionIntegrity } from '@/server/services/project-version-release'

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id } = await context.params
  const integrity = await getProjectVersionIntegrity(parseDecimalId(id))
  return apiOk({
    releaseId: integrity.releaseId,
    storedHash: integrity.storedHash,
    computedHash: integrity.computedHash,
    valid: integrity.valid,
    manifestVersion: integrity.manifestVersion,
    publishedAt: integrity.publishedAt,
    issues: integrity.issues,
  })
})
