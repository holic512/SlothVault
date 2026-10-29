/**
 * @file route.ts
 * @project SlothVault
 * @module Backup Download API
 * @description Serves immutable backup files with authenticated HTTP range downloads.
 * @logic Pin the artifact while streaming, honor matching If-Range validators, and release on close, failure, or cancellation.
 * @dependencies administrator session, Node file streams, private snapshot store
 * @index_tags api,backup,download,range,etag,resume
 * @author holic512
 */
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { artifactPath, getBackupSnapshot, pinSnapshot, requireBackupId } from '@/server/services/admin-backup/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const id = requireBackupId((await context.params).id)
  const release = pinSnapshot(id)
  try {
    const snapshot = await getBackupSnapshot(id)
    const etag = `"${snapshot.sha256}"`
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'Content-Type': 'application/zip',
      'Content-Length': String(snapshot.size),
      'Content-Disposition': `attachment; filename="slothvault-backup-${id}.zip"`,
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
      'ETag': etag,
    })
    let start = 0
    let end = snapshot.size - 1
    let status = 200
    const range = request.headers.get('range')
    const ifRange = request.headers.get('if-range')
    if (request.method !== 'HEAD' && range && (!ifRange || ifRange === etag)) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (match && (match[1] || match[2])) {
        if (match[1]) {
          start = Number(match[1])
          end = match[2] ? Math.min(Number(match[2]), end) : end
        } else {
          const suffix = Number(match[2])
          start = Math.max(0, snapshot.size - suffix)
          if (suffix === 0) start = snapshot.size
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= snapshot.size || start > end) {
          headers.set('Content-Range', `bytes */${snapshot.size}`)
          headers.set('Content-Length', '0')
          release()
          return new Response(null, { status: 416, headers })
        }
        status = 206
        headers.set('Content-Range', `bytes ${start}-${end}/${snapshot.size}`)
        headers.set('Content-Length', String(end - start + 1))
      }
    }
    if (request.method === 'HEAD') {
      release()
      return new Response(null, { headers })
    }
    const stream = createReadStream(artifactPath(id), { start, end })
    stream.once('close', release)
    stream.once('error', release)
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers })
  } catch (error) {
    release()
    throw error
  }
}, { lockMode: 'none', cacheControl: 'no-store' })
export const HEAD = GET
