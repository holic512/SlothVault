/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Version Publish API
 * @description Publishes one validated immutable project version.
 * @logic Authenticate the administrator, parse the version ID, and delegate the atomic idempotent release transaction.
 * @dependencies admin session, HTTP route helpers, project-version release service
 * @index_tags api,admin,project-version,publish,release
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { parseDecimalId } from '@/server/services/admin-catalog'
import { publishProjectVersion } from '@/server/services/project-version-release'

export const dynamic = 'force-dynamic'

export const POST = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id } = await context.params
  return apiOk(await publishProjectVersion(parseDecimalId(id)))
})
