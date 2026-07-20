/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Database Restore API
 * @description Strictly validates and atomically imports a complete business-data backup.
 * @logic Reject oversized or malformed JSON before mutation, validate every record and relationship, then execute optional overwrite deletion and all ID-mapped inserts inside one interactive Prisma transaction.
 * @dependencies admin session, HTTP route helpers, admin backup validation and import service
 * @index_tags api,admin,backup,database,import,transaction
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import {
  assertRequestContentLength,
  DATABASE_IMPORT_CONTENT_LENGTH_MAX_BYTES,
  importDatabaseBackup,
  parseDatabaseImportPayload,
} from '@/server/services/admin-backup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  assertRequestContentLength(request, DATABASE_IMPORT_CONTENT_LENGTH_MAX_BYTES)

  let body: unknown
  try {
    const rawBody = await request.text()
    if (Buffer.byteLength(rawBody, 'utf8') > DATABASE_IMPORT_CONTENT_LENGTH_MAX_BYTES) {
      throw new HttpError('Request body is too large', 413, 413)
    }
    body = JSON.parse(rawBody) as unknown
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError('Invalid backup data', 400, 400)
  }

  const payload = parseDatabaseImportPayload(body)
  try {
    return apiOk(await importDatabaseBackup(payload))
  } catch (error) {
    if (error instanceof HttpError) throw error
    console.error('[backup] Database import failed', error)
    throw new HttpError('Database import failed', 500, 500)
  }
})
