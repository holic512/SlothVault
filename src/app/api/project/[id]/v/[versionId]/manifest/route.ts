/**
 * @file route.ts
 * @project SlothVault
 * @module Public Project Version Manifest API
 * @description Downloads a visible project's verified canonical release manifest.
 * @logic Verify project/version publication and visibility before conditional ETag handling, reject integrity drift, and return byte-exact JSON.
 * @dependencies HTTP route helpers, manifest response, project-version release service
 * @index_tags api,public,project-version,manifest,etag
 * @author holic512
 */
import { defineRoute } from '@/server/http/handler'
import { releaseManifestResponse } from '@/server/http/manifest-response'
import { parseBigIntId } from '@/server/http/request'
import { getProjectVersionManifest } from '@/server/services/project-version-release'
import { getRequestViewer } from '@/server/auth/viewer'

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string; versionId: string }>(
  async (request, context) => {
    const { id, versionId } = await context.params
    return releaseManifestResponse(
      request,
      await getProjectVersionManifest(parseBigIntId(versionId, 'version id'), {
        publicProjectId: parseBigIntId(id, 'project id'),
        viewer: await getRequestViewer(request),
      }),
    )
  },
  { cacheControl: 'private, no-store' },
)

export async function HEAD(request: Parameters<typeof GET>[0], context: Parameters<typeof GET>[1]) {
  const response = await GET(request, context)
  return new Response(null, { status: response.status, headers: response.headers })
}
