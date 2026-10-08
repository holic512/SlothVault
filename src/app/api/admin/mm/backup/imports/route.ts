/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Complete Backup Upload API
 * @description Provides administrator-only local backup management.
 * @logic Authenticate and stream a bounded ZIP into private temporary storage with an administrator-bound ID.
 * @dependencies administrator session, HTTP route helpers, local backup services
 * @index_tags api,admin,backup,restore,persistence
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { assertBackupIdle, uploadCompleteBackup } from '@/server/services/admin-backup/complete'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  await assertBackupIdle()
  return apiOk(await uploadCompleteBackup(request, session.userId), 'Backup uploaded', 201)
}, { lockMode: 'none', cacheControl: 'no-store' })
