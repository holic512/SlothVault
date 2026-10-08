/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Restore Preview API
 * @description Provides administrator-only local backup management.
 * @logic Validate the complete artifact and account policy, then persist a short-lived administrator-bound preview.
 * @dependencies administrator session, HTTP route helpers, local backup services
 * @index_tags api,admin,backup,restore,persistence
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { previewCompleteRestore } from '@/server/services/admin-backup/complete'
import { sourceSchema } from '@/server/services/admin-backup/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  return apiOk(await previewCompleteRestore(await readJson(request, sourceSchema, { maxBytes: 4096 }), session.userId))
}, { lockMode: 'none', cacheControl: 'no-store' })
