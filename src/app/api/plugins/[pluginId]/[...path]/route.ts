/**
 * @file route.ts
 * @project SlothVault
 * @module Plugin API Dispatcher
 * @description Routes declared JSON APIs through host-owned auth, rate limits and maintenance boundaries.
 * @logic Reject disabled or undeclared endpoints, bind the actor from the session, then invoke the isolated worker.
 * @dependencies plugin manager/access, shared auth, HTTP handler, rate limits
 * @index_tags plugins,api,dispatch,authorization
 * @author holic512
 */
import { z } from 'zod'
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
  const params = await context.params; const id = pluginIdSchema.parse(params.pluginId); await initializePlugins()
  const item = pluginRegistry.get(id)
  if (!item?.installed) throw new HttpError('Plugin is not installed', 404)
  if (!item.enabled) throw new HttpError('Plugin is disabled', 409, 409, { reason: 'PLUGIN_DISABLED' })
  const endpoint = item.manifest.api.find((api: PluginManifest['api'][number]) => api.method === request.method && api.path === params.path.join('/'))
  if (!endpoint) throw new HttpError('Plugin API not found', 404)
  const session = await readSession(request), actor = session ? { userId: session.userId, role: session.User.role } : null
  await requirePluginAccess(boundPluginAccess(item, endpoint.access), actor)
  const mutation = !['GET', 'HEAD'].includes(request.method)
  if (mutation && !isSameOriginRequest(request)) throw new HttpError('Same-origin request required', 403)
  if (id === 'slothvault.sol-payments' && mutation) await enforceRateLimit({ scope: `sol-payments:${endpoint.key}`, identity: String(actor?.userId), limit: endpoint.key === 'create' ? 6 : endpoint.key === 'reconcile' ? 12 : 20, windowSeconds: 60 })
  await enforceRateLimit({ scope: 'plugin-api', identity: `${id}:${endpoint.key}:${actor?.userId ?? requestClientIp(request)}`, limit: id === 'slothvault.gift-cards' && endpoint.key === 'redeem' ? 12 : 120, windowSeconds: id === 'slothvault.gift-cards' && endpoint.key === 'redeem' ? 900 : 60 })
  const input = mutation ? await readJson(request, z.unknown(), { maxBytes: 1024 * 1024 }) : undefined
  return apiOk(await invokeRegisteredPlugin(item, 'api', endpoint.key, { actor, input, query: Object.fromEntries(request.nextUrl.searchParams), params: params.path }, false, !mutation))
}, { cacheControl: 'private, no-store' })
export const GET = dispatch
export const POST = dispatch
export const PUT = dispatch
export const PATCH = dispatch
export const DELETE = dispatch
