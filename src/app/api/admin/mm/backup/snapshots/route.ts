/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Backup History and Tasks API
 * @description Provides administrator-only local backup management.
 * @logic Return durable history without holding the maintenance lock and register complete backups after the response.
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
import { backupHistory, failQueuedBackup, queueCompleteBackup, runCompleteBackup } from '@/server/services/admin-backup/complete'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  return apiOk(await backupHistory())
}, { lockMode: 'none', cacheControl: 'no-store' })

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  const body = request.body ? await readJson(request, z.object({ retryJobId: z.string().uuid().optional() }).strict(), { maxBytes: 4096 }) : {}
  const job = await queueCompleteBackup(session.userId, 'manual', body.retryJobId)
  try { after(() => runCompleteBackup(job)) }
  catch (error) { await failQueuedBackup(job, error); throw error }
  return apiOk(job, 'Backup queued', 202)
}, { lockMode: 'none', cacheControl: 'no-store' })
