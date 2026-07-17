/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Files Backup API
 * @description Streams a ZIP archive of visible regular files from the configured upload storage root.
 * @logic Authenticate, retain the shared application-state lock through stream completion, recursively enumerate contained entries while skipping hidden paths and symlinks, then finalize an Archiver stream with a safe attachment filename.
 * @dependencies admin session, Web Response streams, archiver, admin backup service, shared route lock
 * @index_tags api,admin,backup,files,zip,export,stream
 * @author holic512
 */
import { Readable } from 'node:stream'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { createFilesExportArchive } from '@/server/services/admin-backup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function attachmentHeader(fileName: string) {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)

  try {
    const archive = await createFilesExportArchive()
    const body = Readable.toWeb(archive) as ReadableStream<Uint8Array>
    void archive.finalize().catch((error) => archive.destroy(error))
    const fileName = `uploads-backup-${Date.now()}.zip`
    return new Response(body, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': attachmentHeader(fileName),
        'Content-Type': 'application/zip',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('[backup] Files export failed', error)
    throw new HttpError('Files export failed', 500, 500)
  }
}, { holdLockUntilBodyClosed: true })
