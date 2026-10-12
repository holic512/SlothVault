/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Complete Backup Upload API
 * @description Provides administrator-only local backup management.
 * @logic Authenticate and create a durable administrator-bound upload session without receiving the entire backup.
 * @dependencies administrator session, HTTP route helpers, local backup services
 * @index_tags api,admin,backup,restore,persistence
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { readJson } from '@/server/http/request'
import { createBackupUpload, uploadInputSchema } from '@/server/services/admin-backup/uploads'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  return apiOk(await createBackupUpload(await readJson(request, uploadInputSchema, {maxBytes:4096}), session.userId), 'Upload session created', 201)
}, { lockMode: 'none', cacheControl: 'no-store' })
