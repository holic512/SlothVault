/**
 * @file route.ts
 * @project SlothVault
 * @module Plugin Management API
 * @description Lists installations and previews local or GitHub Release packages without executing their code.
 * @logic Authenticate administrators, validate same-origin writes, bound uploads, and return static package metadata for explicit trust confirmation.
 * @dependencies plugin manager, package verifier, GitHub source, HTTP boundaries
 * @index_tags plugins,admin,api,upload,preview
 * @author holic512
 */
import { z } from 'zod'
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { HttpError } from '@/server/http/errors'
import { isSameOriginRequest } from '@/server/http/same-origin'
import { readJson } from '@/server/http/request'
import { listPlugins } from '@/server/plugins/manager'
import { MAX_PLUGIN_PACKAGE_BYTES, stagePluginPackage, verifyPluginPackage } from '@/server/plugins/packages'
import { downloadPluginRelease, githubRepository, OFFICIAL_PLUGINS, officialPluginSourceMatches } from '@/server/plugins/sources'

export const dynamic = 'force-dynamic'
export const GET = defineRoute(
  async request => {
    await requireAdminSession(request)
    return apiOk(await listPlugins())
  },
  { cacheControl: 'private, no-store' }
)
export const POST = defineRoute(async request => {
  await requireAdminSession(request)
  if (!isSameOriginRequest(request)) throw new HttpError('Same-origin request required', 403)
  let bytes: Buffer
  let source: string | null = null
  if (request.headers.get('content-type')?.includes('application/json')) {
    const input = await readJson(
      request,
      z.object({
        repository: z.string().max(200),
        tag: z.string().max(150),
        asset: z.string().max(200),
        pluginId: z.string().optional(),
        expectedPluginId: z.string().optional(),
      }).strict(),
      { maxBytes: 4096 }
    )
    source = githubRepository(input.repository)
    if (input.pluginId) {
      const official = OFFICIAL_PLUGINS.find(item => item.id === input.pluginId)
      if (!official || !officialPluginSourceMatches(official, source, input.tag, input.asset)) {
        throw new HttpError('Official source identity mismatch', 400)
      }
    }
    if (input.expectedPluginId) {
      const official = OFFICIAL_PLUGINS.find(item => item.id === input.expectedPluginId && item.repository === source)
      if (official && !officialPluginSourceMatches(official, source, input.tag, input.asset)) {
        throw new HttpError('Official source identity mismatch', 400)
      }
    }
    bytes = await downloadPluginRelease(source, input.tag, input.asset)
    if (input.expectedPluginId && (await verifyPluginPackage(bytes)).manifest.id !== input.expectedPluginId) {
      throw new HttpError('Plugin identity mismatch', 400)
    }
    if (input.pluginId && (await verifyPluginPackage(bytes)).manifest.id !== input.pluginId) {
      throw new HttpError('Official package ID mismatch', 400)
    }
  } else {
    if (Number(request.headers.get('content-length')) > MAX_PLUGIN_PACKAGE_BYTES) {
      throw new HttpError('Plugin upload is too large', 413)
    }
    const chunks: Uint8Array[] = []
    let size = 0
    if (!request.body) throw new HttpError('Plugin file required', 400)
    const reader = request.body.getReader()
    try {
      for (; ;) {
        const item = await reader.read()
        if (item.done) {
          break
        }
        size += item.value.length
        if (size > MAX_PLUGIN_PACKAGE_BYTES) {
          throw new HttpError('Plugin upload is too large', 413)
        }
        chunks.push(item.value)
      }
    } finally {
      await reader.cancel().catch(() => undefined)
    }
    bytes = Buffer.concat(chunks)
  }
  const verified = await stagePluginPackage(bytes)
  return apiOk({ manifest: verified.manifest, digest: verified.digest, source, verified: true })
}, { cacheControl: 'private, no-store', lockMode: 'none' })
