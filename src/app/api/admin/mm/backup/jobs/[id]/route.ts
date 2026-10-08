/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Backup Task Status API
 * @description Provides administrator-only local backup management.
 * @logic Authenticate and return a durable task phase without blocking on a running restore.
 * @dependencies administrator session, HTTP route helpers, local backup services
 * @index_tags api,admin,backup,restore,persistence
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { getBackupJob } from '@/server/services/admin-backup/complete'
import { requireBackupId } from '@/server/services/admin-backup/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  return apiOk(await getBackupJob(requireBackupId((await context.params).id)))
}, { lockMode: 'none', cacheControl: 'no-store' })
