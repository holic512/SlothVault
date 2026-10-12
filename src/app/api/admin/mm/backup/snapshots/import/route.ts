/**
 * @file route.ts
 * @project SlothVault
 * @module Backup Snapshot Import API
 * @description Queues administrator-owned uploads for validation and permanent snapshot publication.
 * @logic Authenticate the upload owner, reuse repeated requests, and run new imports after returning a durable task.
 * @dependencies administrator session, complete backup operations, Next.js background tasks
 * @index_tags api,backup,import,snapshot,idempotency
 * @author holic512
 */
import { after } from 'next/server'
import { z } from 'zod'
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { failQueuedBackup, queueCompleteImport, runCompleteImport } from '@/server/services/admin-backup/complete'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  const { importId } = await readJson(request, z.object({ importId: z.string().uuid() }).strict(), { maxBytes: 4096 })
  const { job, queued } = await queueCompleteImport(importId, session.userId)
  if (queued) {
    try { after(() => runCompleteImport(job)) }
    catch (error) { await failQueuedBackup(job, error); throw error }
  }
  return apiOk(job, queued ? 'Backup import queued' : 'Existing backup import', 202)
}, { lockMode: 'none', cacheControl: 'no-store' })
