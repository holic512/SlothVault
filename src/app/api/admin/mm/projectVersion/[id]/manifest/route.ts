/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Version Manifest API
 * @description Downloads a verified canonical manifest for administrators.
 * @logic Authenticate first, rebuild and verify release integrity, then emit byte-exact JSON with digest and ETag headers.
 * @dependencies admin session, manifest response, project-version release service
 * @index_tags api,admin,project-version,manifest,download
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { releaseManifestResponse } from '@/server/http/manifest-response'
import { parseDecimalId } from '@/server/services/admin-catalog'
import { getProjectVersionManifest } from '@/server/services/project-version-release'

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id } = await context.params
  return releaseManifestResponse(
    request,
    await getProjectVersionManifest(parseDecimalId(id)),
  )
})
