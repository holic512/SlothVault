/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Complete Restore Tasks API
 * @description Provides administrator-only local backup management.
 * @logic Require typed confirmation, bind to a validated preview, and register the protected restore after the response.
 * @dependencies administrator session, HTTP route helpers, local backup services
 * @index_tags api,admin,backup,restore,persistence
 * @author holic512
 */
import { after } from 'next/server'
import { z } from 'zod'
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { failQueuedBackup, queueCompleteRestore, runCompleteRestore } from '@/server/services/admin-backup/complete'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  const body = await readJson(request, z.object({ previewId: z.string().uuid(), confirm: z.literal('RESTORE_BACKUP') }).strict(), { maxBytes: 4096 })
  const job = await queueCompleteRestore(body.previewId, session.userId)
  try { after(() => runCompleteRestore(job, body.previewId, session.id)) }
  catch (error) { await failQueuedBackup(job, error); throw error }
  return apiOk(job, 'Restore queued', 202)
}, { lockMode: 'none', cacheControl: 'no-store' })
