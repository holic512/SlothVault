/**
 * @file route.ts
 * @project SlothVault
 * @module Plugin Source API
 * @description Lists official sources or stable Release packages from a selected GitHub repository.
 * @logic Authenticate discovery and keep repository source distinct from executable package installation.
 * @dependencies GitHub plugin source, admin auth, HTTP handler
 * @index_tags plugins,github,releases,admin
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { HttpError } from '@/server/http/errors'
import { apiOk } from '@/server/http/response'
import { listPluginReleases, OFFICIAL_PLUGINS } from '@/server/plugins/sources'
export const GET = defineRoute(async request => {
  await requireAdminSession(request)
  const id = request.nextUrl.searchParams.get('pluginId')
  if (id) {
    const official = OFFICIAL_PLUGINS.find(item => item.id === id)
    if (!official) throw new HttpError('Unknown official plugin', 404)
    return apiOk(await listPluginReleases(official.repository, official.tagPrefix, official.id))
  }
  const repo = request.nextUrl.searchParams.get('repository')
  return apiOk(repo ? await listPluginReleases(repo) : OFFICIAL_PLUGINS)
}, { cacheControl: 'private, no-store', lockMode: 'none' })
