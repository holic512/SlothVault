/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Backup Download API
 * @description Provides administrator-only local backup management.
 * @logic Pin an immutable server-selected artifact until the native download stream closes.
 * @dependencies administrator session, HTTP route helpers, local backup services
 * @index_tags api,admin,backup,restore,persistence
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
  const id = requireBackupId((await context.params).id), release = pinSnapshot(id)
  try {
    const snapshot = await getBackupSnapshot(id)
    const stream = createReadStream(artifactPath(id))
    stream.once('close', release)
    stream.once('error', release)
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/zip',
        'Content-Length': String(snapshot.size),
        'Content-Disposition': `attachment; filename="slothvault-backup-${id}.zip"`,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) { release(); throw error }
}, { lockMode: 'none', cacheControl: 'no-store' })
