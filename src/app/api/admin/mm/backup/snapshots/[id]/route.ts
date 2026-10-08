/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Backup Deletion API
 * @description Provides administrator-only local backup management.
 * @logic Delete only a server-selected snapshot after confirmation and reject pinned artifacts.
 * @dependencies administrator session, HTTP route helpers, local backup services
 * @index_tags api,admin,backup,restore,persistence
 * @author holic512
 */
import { z } from 'zod'
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { deleteBackupSnapshot } from '@/server/services/admin-backup/complete'
import { requireBackupId } from '@/server/services/admin-backup/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const id = requireBackupId((await context.params).id)
  await readJson(request, z.object({ confirm: z.literal('DELETE_BACKUP') }).strict(), { maxBytes: 4096 })
  await deleteBackupSnapshot(id)
  return apiOk({ id })
}, { lockMode: 'none', cacheControl: 'no-store' })
