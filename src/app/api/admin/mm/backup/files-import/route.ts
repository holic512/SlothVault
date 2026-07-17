/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Files Restore API
 * @description Validates and restores a bounded ZIP backup through hidden staging and rollback directories.
 * @logic Authenticate, enforce request and ZIP limits, require insert or overwrite mode, then reject unsafe entries before extraction and atomically commit the staged tree without silent overwrites.
 * @dependencies admin session, Web FormData, HTTP response helpers, admin backup ZIP service
 * @index_tags api,admin,backup,files,zip,import,zip-slip,rollback
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import {
  assertRequestContentLength,
  FILES_IMPORT_CONTENT_LENGTH_MAX_BYTES,
  importFilesBackup,
  type ImportMode,
  ZIP_FILE_MAX_BYTES,
} from '@/server/services/admin-backup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  assertRequestContentLength(request, FILES_IMPORT_CONTENT_LENGTH_MAX_BYTES)
  const contentType = request.headers.get('content-type')?.toLowerCase() || ''
  if (!contentType.startsWith('multipart/form-data')) {
    throw new HttpError('Expected multipart/form-data', 400, 400)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    throw new HttpError('Invalid file upload', 400, 400)
  }

  const parsedFormSize = Array.from(formData.values()).reduce(
    (total, entry) =>
      total +
      (typeof entry === 'string'
        ? Buffer.byteLength(entry, 'utf8')
        : entry.size),
    0,
  )
  if (parsedFormSize > FILES_IMPORT_CONTENT_LENGTH_MAX_BYTES) {
    throw new HttpError('Request body is too large', 413, 413)
  }

  const fileEntries = formData.getAll('file')
  if (
    fileEntries.length !== 1 ||
    typeof fileEntries[0] === 'string'
  ) {
    throw new HttpError('Invalid file upload', 400, 400)
  }
  const file = fileEntries[0]
  if (file.size === 0) throw new HttpError('Invalid file upload', 400, 400)
  if (file.size > ZIP_FILE_MAX_BYTES) {
    throw new HttpError('ZIP file exceeds the 250MB limit', 413, 413)
  }

  const modeEntry = formData.get('mode')
  const modeRaw = modeEntry === null ? 'insert' : modeEntry
  if (typeof modeRaw !== 'string' || (modeRaw !== 'insert' && modeRaw !== 'overwrite')) {
    throw new HttpError('Invalid mode', 400, 400)
  }
  const mode: ImportMode = modeRaw

  const result = await importFilesBackup(
    Buffer.from(await file.arrayBuffer()),
    mode,
  )
  return apiOk(result)
})
