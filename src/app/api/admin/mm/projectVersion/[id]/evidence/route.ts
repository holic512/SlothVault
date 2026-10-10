/**
 * @file route.ts
 * @project SlothVault
 * @module Administrator Version Credential API
 * @description Reads published version credentials for authenticated preview navigation.
 * @logic Require an administrator before exposing hidden publication metadata and its download capability.
 * @dependencies admin session, release-evidence, HTTP route helpers
 * @index_tags api,admin,preview,project-version,evidence
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { getProjectVersionEvidenceSummary } from '@/server/services/release-evidence'
export const dynamic = 'force-dynamic'
export const GET = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireAdminSession(request)
  const { id } = await context.params
  return apiOk(await getProjectVersionEvidenceSummary(parseBigIntId(id, 'version id'), { viewer: { userId: session.User.id, role: 'ADMIN' } }))
}, { cacheControl: 'private, no-store' })
