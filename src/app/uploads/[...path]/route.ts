/**
 * @file route.ts
 * @project SlothVault
 * @module Upload Runtime
 * @description Serves contained managed uploads after checking current reading or download permissions for GET and HEAD.
 * @logic Validate paths, authorize real live references before reading bytes, use private responses, attach download formats without MIME sniffing, and enqueue privacy-safe request/wait/handler timings.
 * @dependencies Next Route Handlers, file-access, admin file storage service, maintenance-lock
 * @index_tags uploads,permissions,path-containment,get,head,security-headers,maintenance-lock
 * @author holic512
 */
import { parsePublicContentId, publishedProjectWhere } from '@/server/services/public-content-ids'
import { prisma } from '@/server/prisma'
import { isAdminRole } from '@/server/auth/roles'
import { createRequestProbe } from '@/server/telemetry/request'
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
    const viewer = await getRequestViewer(request)
    let projectId: number | undefined
    if (projectRaw !== null) {
      const project = await prisma.project.findFirst({
        where: { publicId: parsePublicContentId(projectRaw), ...(viewer && isAdminRole(viewer.role) ? { isDeleted: false } : publishedProjectWhere) },
        select: { id: true },
      })
      if (!project) throw new HttpError('Project not found', 404, 404)
      projectId = project.id
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
    await authorizeManagedFile(filePath, viewer, {
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

async function measuredUpload(request: NextRequest, context: UploadRouteContext, headOnly: boolean) {
  const probe = createRequestProbe(request), waitStarted = performance.now()
  try {
    const response = await withMaintenanceLock('shared', async () => {
      probe?.wait(performance.now() - waitStarted)
      const started = performance.now()
      try { return await serveUpload(request, context, headOnly) }
      finally { probe?.handler(performance.now() - started) }
    })
    probe?.finish(response.status)
    return response
  } catch (error) { probe?.finish(500); throw error }
}
export async function GET(request: NextRequest, context: UploadRouteContext) { return measuredUpload(request, context, false) }
export async function HEAD(request: NextRequest, context: UploadRouteContext) { return measuredUpload(request, context, true) }
