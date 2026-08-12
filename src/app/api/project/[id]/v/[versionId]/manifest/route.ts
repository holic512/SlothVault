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

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string; versionId: string }>(
  async (request, context) => {
    const { id, versionId } = await context.params
    return releaseManifestResponse(
      request,
      await getProjectVersionManifest(parseBigIntId(versionId, 'version id'), {
        publicProjectId: parseBigIntId(id, 'project id'),
      }),
    )
  },
)
