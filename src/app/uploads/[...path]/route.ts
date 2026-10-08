/**
 * @file route.ts
 * @project SlothVault
 * @module Upload Runtime
 * @description Serves contained managed uploads after checking current reading or download permissions for GET and HEAD.
 * @logic Validate paths, authorize real live references before reading bytes, use private responses, and attach download formats without MIME sniffing.
 * @dependencies Next Route Handlers, file-access, admin file storage service, maintenance-lock
 * @index_tags uploads,permissions,path-containment,get,head,security-headers,maintenance-lock
 * @author holic512
 */
import { HttpError } from '@/server/http/errors'
import type { NextRequest } from 'next/server'
import { getRequestViewer } from '@/server/auth/viewer'
import { authorizeManagedFile } from '@/server/services/file-access'
import { isInlineImagePath } from '@/lib/managed-file-paths'
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

function responseHeaders(file: Awaited<ReturnType<typeof inspectPublicUpload>>, download: boolean) {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Length': file.stats.size.toString(),
    'Content-Type': file.contentType,
    'Last-Modified': file.stats.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  })
  if (file.attachment || download) {
    headers.set('Content-Disposition', contentDisposition(file.fileName))
  }
  return headers
}

async function serveUpload(request: NextRequest, context: UploadRouteContext, headOnly: boolean) {
  try {
    const { path } = await context.params
    const projectRaw = request.nextUrl.searchParams.get('projectId')
    const projectId = projectRaw === null ? undefined : Number(projectRaw)
    if (projectId !== undefined && (!/^\d+$/.test(projectRaw!) || !Number.isSafeInteger(projectId) || projectId < 1)) {
      throw new HttpError('Invalid project id', 400, 400)
    }
    let segments: string[]
    try { segments = path.map((segment) => decodeURIComponent(segment)) } catch {
      throw new HttpError('Invalid file path', 400, 400)
    }
    if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..' || /[/\\\u0000]/.test(segment))) {
      throw new HttpError('Invalid file path', 400, 400)
    }
    const filePath = `uploads/${segments.join('/')}`
    const download = request.nextUrl.searchParams.get('download') === '1' || !isInlineImagePath(filePath)
    await authorizeManagedFile(filePath, await getRequestViewer(request), {
      projectId, download,
    })
    const file = await inspectPublicUpload(path)
    const headers = responseHeaders(file, download)
    if (headOnly) return new Response(null, { status: 200, headers })

    const buffer = await readPublicUpload(file.absolutePath)
    return new Response(new Uint8Array(buffer), { status: 200, headers })
  } catch (error) {
    if (error instanceof HttpError) {
      return new Response(error.message, {
        status: error.status,
        headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' },
      })
    }
    console.error('[uploads] Failed to serve file', error)
    return new Response('Failed to serve file', {
      status: 500,
      headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' },
    })
  }
}

export async function GET(request: NextRequest, context: UploadRouteContext) {
  return withMaintenanceLock('shared', () => serveUpload(request, context, false))
}

export async function HEAD(request: NextRequest, context: UploadRouteContext) {
  return withMaintenanceLock('shared', () => serveUpload(request, context, true))
}
