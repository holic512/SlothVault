/**
 * @file route.ts
 * @project SlothVault
 * @module Upload Runtime
 * @description Serves contained files from the configured upload storage root with safe media headers and a metadata-only HEAD path.
 * @logic Hold the shared application-state lock while decoding, validating, and reading a contained uploads/* file, then reject directories and attach non-previewable formats without MIME sniffing.
 * @dependencies Next Route Handlers, node:fs/promises, admin file storage service, maintenance-lock
 * @index_tags uploads,public-files,path-containment,get,head,security-headers,maintenance-lock
 * @author holic512
 */
import { HttpError } from '@/server/http/errors'
import {
  inspectPublicUpload,
  readPublicUpload,
} from '@/server/services/admin-files'
import { withMaintenanceLock } from '@/server/services/maintenance-lock'

type UploadRouteContext = {
  params: Promise<{ path: string[] }>
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function contentDisposition(fileName: string) {
  const fallback = fileName
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function responseHeaders(file: Awaited<ReturnType<typeof inspectPublicUpload>>) {
  const headers = new Headers({
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Length': file.stats.size.toString(),
    'Content-Type': file.contentType,
    'Last-Modified': file.stats.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  })
  if (file.attachment) {
    headers.set('Content-Disposition', contentDisposition(file.fileName))
  }
  return headers
}

async function serveUpload(context: UploadRouteContext, headOnly: boolean) {
  try {
    const { path } = await context.params
    const file = await inspectPublicUpload(path)
    const headers = responseHeaders(file)
    if (headOnly) return new Response(null, { status: 200, headers })

    const buffer = await readPublicUpload(file.absolutePath)
    return new Response(new Uint8Array(buffer), { status: 200, headers })
  } catch (error) {
    if (error instanceof HttpError) {
      return new Response(error.message, {
        status: error.status,
        headers: { 'X-Content-Type-Options': 'nosniff' },
      })
    }
    console.error('[uploads] Failed to serve file', error)
    return new Response('Failed to serve file', {
      status: 500,
      headers: { 'X-Content-Type-Options': 'nosniff' },
    })
  }
}

export async function GET(_request: Request, context: UploadRouteContext) {
  return withMaintenanceLock('shared', () => serveUpload(context, false))
}

export async function HEAD(_request: Request, context: UploadRouteContext) {
  return withMaintenanceLock('shared', () => serveUpload(context, true))
}
