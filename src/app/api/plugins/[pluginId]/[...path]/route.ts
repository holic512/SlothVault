/**
 * @file route.ts
 * @project SlothVault
 * @module Plugin API Dispatcher
 * @description Routes declared JSON and private streaming file APIs through host-owned auth, rate limits and maintenance boundaries.
 * @logic Reject disabled or undeclared endpoints, bind the actor from the session, then invoke the isolated worker.
 * @dependencies plugin manager/access, shared auth, HTTP handler, rate limits
 * @index_tags plugins,api,dispatch,authorization
 * @author holic512
 */
import { z } from 'zod'
import { savePluginUpload, deletePluginUpload, streamPluginFile, pluginArchive, PLUGIN_FILE_MAX_BYTES } from '@/server/plugins/files'
import { pluginIdSchema, type PluginManifest } from '@slothvault/plugin-sdk/protocol'
import { readSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { HttpError } from '@/server/http/errors'
import { apiOk } from '@/server/http/response'
import { isSameOriginRequest } from '@/server/http/same-origin'
import { readJson, requestClientIp } from '@/server/http/request'
import { enforceRateLimit } from '@/server/short-lived-state'
import { initializePlugins, invokeRegisteredPlugin } from '@/server/plugins/manager'
import { pluginRegistry } from '@/server/plugins/state'
import { boundPluginAccess, requirePluginAccess } from '@/server/plugins/access'

const dispatch = defineRoute<{ pluginId: string; path: string[] }>(async (request, context) => {
  const params = await context.params
  const id = pluginIdSchema.parse(params.pluginId)
  await initializePlugins()
  const item = pluginRegistry.get(id)
  if (!item?.installed) throw new HttpError('Plugin is not installed', 404)
  if (!item.enabled) throw new HttpError('Plugin is disabled', 409, 409, { reason: 'PLUGIN_DISABLED' })
  const endpoint = item.manifest.api.find((api: PluginManifest['api'][number]) => api.method === request.method && api.path === params.path.join('/'))
  if (!endpoint) throw new HttpError('Plugin API not found', 404)
  const session = await readSession(request)
  const actor = session ? { userId: session.userId, role: session.User.role } : null
  await requirePluginAccess(boundPluginAccess(item, endpoint.access), actor)
  const mutation = !['GET', 'HEAD'].includes(request.method)
  if (mutation && !isSameOriginRequest(request)) throw new HttpError('Same-origin request required', 403)
  if (id === 'slothvault.sol-payments' && mutation) {
    await enforceRateLimit({
      scope: `sol-payments:${endpoint.key}`,
      identity: String(actor?.userId),
      limit: endpoint.key === 'create' ? 6 : endpoint.key === 'reconcile' ? 12 : 20,
      windowSeconds: 60,
    })
  }
  await enforceRateLimit({
    scope: 'plugin-api',
    identity: `${id}:${endpoint.key}:${actor?.userId ?? requestClientIp(request)}`,
    limit: id === 'slothvault.gift-cards' && endpoint.key === 'redeem' ? 12 : 120,
    windowSeconds: id === 'slothvault.gift-cards' && endpoint.key === 'redeem' ? 900 : 60,
  })
  if (endpoint.rateLimit) {
    await enforceRateLimit({
      scope: `plugin:${id}:${endpoint.key}`,
      identity: String(actor?.userId ?? requestClientIp(request)),
      ...endpoint.rateLimit,
    })
  }
  const invocation = { actor, query: Object.fromEntries(request.nextUrl.searchParams), params: params.path }
  if (endpoint.transport === 'upload') {
    if (!item.manifest.capabilities.includes('files.private') || !request.body) {
      throw new HttpError('Private file upload is unavailable', 400)
    }
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/octet-stream') {
      throw new HttpError('Expected application/octet-stream upload', 415)
    }
    const sizeHeader = request.headers.get('x-file-size') ?? ''
    if (!/^\d+$/.test(sizeHeader) || !Number.isSafeInteger(Number(sizeHeader)) ||
      Number(sizeHeader) > PLUGIN_FILE_MAX_BYTES) {
      throw new HttpError('File exceeds the upload limit', 413)
    }
    const size = Number(sizeHeader)
    let name: string
    try {
      name = decodeURIComponent(request.headers.get('x-file-name') ?? '')
    } catch {
      throw new HttpError('Invalid filename', 400)
    }
    // Authorize the record before reading any bytes. The second call rechecks revision/ownership.
    await invokeRegisteredPlugin(item, 'api', endpoint.key, { ...invocation, input: { phase: 'authorize' } }, false, true)
    const upload = await savePluginUpload(id, { name, size, stream: () => request.body! })
    try {
      return apiOk(await invokeRegisteredPlugin(item, 'api', endpoint.key, { ...invocation, input: { phase: 'complete', upload } }, false, false))
    } catch (error) {
      // A timeout may occur after the plugin committed its file reference. Never delete uncertain commits.
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
        await deletePluginUpload(id, upload.id)
      }
      throw error
    }
  }
  if (endpoint.transport === 'download' || endpoint.transport === 'archive') {
    if (!item.manifest.capabilities.includes('files.private')) {
      throw new HttpError('Private files capability was not declared', 403)
    }
    const result = await invokeRegisteredPlugin(item, 'api', endpoint.key, invocation, false, true)
    if (endpoint.transport === 'download') {
      const file = z.object({ fileId: z.string().uuid(), name: z.string().max(255).optional() }).strict().parse(result)
      return streamPluginFile(id, file.fileId, file.name)
    }
    const archive = z
      .object({
        name: z.string().max(255),
        entries: z.array(z.object({
          path: z.string().max(500),
          fileId: z.string().uuid().optional(),
          text: z.string().max(2_000_000).optional(),
        }).strict()).max(1000),
      })
      .strict()
      .parse(result)
    return pluginArchive(id, archive)
  }
  const input = mutation ? await readJson(request, z.unknown(), { maxBytes: 1024 * 1024 }) : undefined
  return apiOk(await invokeRegisteredPlugin(
    item,
    'api',
    endpoint.key,
    { actor, input, query: Object.fromEntries(request.nextUrl.searchParams), params: params.path },
    false,
    !mutation
  ))
}, { cacheControl: 'private, no-store' })
export const GET = dispatch
export const POST = dispatch
export const PUT = dispatch
export const PATCH = dispatch
export const DELETE = dispatch
