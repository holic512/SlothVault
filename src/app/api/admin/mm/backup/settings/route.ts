/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Backup Settings API
 * @description Provides administrator-only local backup management.
 * @logic Authenticate administrators and persist the opt-in local daily schedule.
 * @dependencies administrator session, HTTP route helpers, local backup services
 * @index_tags api,admin,backup,restore,persistence
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { assertBackupIdle } from '@/server/services/admin-backup/complete'
import { backupSettingsResponse, saveBackupSettings } from '@/server/services/admin-backup/scheduler'
import { settingsSchema } from '@/server/services/admin-backup/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  return apiOk(await backupSettingsResponse())
}, { lockMode: 'none', cacheControl: 'no-store' })

export const PUT = defineRoute(async (request) => {
  await requireAdminSession(request)
  await assertBackupIdle()
  await saveBackupSettings(await readJson(request, settingsSchema, { maxBytes: 4096 }))
  return apiOk(await backupSettingsResponse())
}, { cacheControl: 'no-store' })
