/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Database Backup API
 * @description Exports a relation-closed active-business-data snapshot without authentication tables.
 * @logic Authenticate, read a relation-closed repeatable snapshot, preserve membership grants, immutable releases and transaction evidence, convert BigInt values to strings, and return backup format 2.7.0.
 * @dependencies admin session, HTTP response helpers, admin backup service
 * @index_tags api,admin,backup,database,export
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { exportDatabaseBackup } from '@/server/services/admin-backup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  try {
    return apiOk(await exportDatabaseBackup())
  } catch (error) {
    console.error('[backup] Database export failed', error)
    throw new HttpError('Database export failed', 500, 500)
  }
})
