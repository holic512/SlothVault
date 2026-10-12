/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Restore Preview API
 * @description Provides administrator-only local backup management.
 * @logic Queue an authenticated background validation job and return before reading the backup contents.
 * @dependencies administrator session, HTTP route helpers, local backup services
 * @index_tags api,admin,backup,restore,persistence
 * @author holic512
 */
import { after } from 'next/server'
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { failQueuedBackup, queueCompletePreview, runCompletePreview } from '@/server/services/admin-backup/complete'
import { sourceSchema } from '@/server/services/admin-backup/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  const job = await queueCompletePreview(await readJson(request, sourceSchema, { maxBytes: 4096 }), session.userId)
  try { after(() => runCompletePreview(job)) } catch(error) { await failQueuedBackup(job,error); throw error }
  return apiOk(job,'Restore preview queued',202)
}, { lockMode: 'none', cacheControl: 'no-store' })
