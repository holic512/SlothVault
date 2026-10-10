/**
 * @file route.ts
 * @project SlothVault
 * @module Public Version Credential API
 * @description Reads a compact publication snapshot and stored network statuses without bodies or RPC.
 * @logic Validate visible project/version identity and resolve request-local download permissions.
 * @dependencies release-evidence, HTTP route helpers, viewer
 * @index_tags api,project-version,evidence,permissions
 * @author holic512
 */
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { getRequestViewer } from '@/server/auth/viewer'
import { getProjectVersionEvidenceSummary } from '@/server/services/release-evidence'
export const dynamic = 'force-dynamic'
export const GET = defineRoute<{ id: string; versionId: string }>(async (request, context) => {
  const { id, versionId } = await context.params
  return apiOk(await getProjectVersionEvidenceSummary(parseBigIntId(versionId, 'version id'), { publicProjectId: parseBigIntId(id, 'project id'), viewer: await getRequestViewer(request) }))
}, { cacheControl: 'private, no-store' })
