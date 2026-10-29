/**
 * @file route.ts
 * @project SlothVault
 * @module Verified Plugin UI Assets
 * @description Serves only active declared frontend entrypoints after host permission checks.
 * @logic Pin the requested digest and contribution access, reject arbitrary package reads, and never serve backend code.
 * @dependencies plugin registry/access, private package storage, session service
 * @index_tags plugins,assets,frontend,permissions
 * @author holic512
 */
import { readSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { HttpError } from '@/server/http/errors'
import { initializePlugins } from '@/server/plugins/manager'
import { pluginRegistry } from '@/server/plugins/state'
import { boundPluginAccess, canAccessPlugin } from '@/server/plugins/access'
import { readVerifiedPluginAsset } from '@/server/plugins/packages'

export const GET = defineRoute<{ pluginId: string; digest: string; path: string[] }>(async (request, context) => {
  await initializePlugins()
  const { pluginId, digest, path } = await context.params
  const item = pluginRegistry.get(pluginId)
  const asset = path.join('/')
  if (!item?.enabled || !item.installed || item.digest !== digest) {
    throw new HttpError('Plugin asset is unavailable', 404)
  }
  const session = await readSession(request)
  const actor = session ? { userId: session.userId, role: session.User.role } : null
  let allowed = false
  for (const ui of item.manifest.ui) {
    if ((ui.asset === asset || ui.css === asset) &&
      await canAccessPlugin(boundPluginAccess(item, ui.access), actor)) {
      allowed = true
    }
  }
  if (!allowed) throw new HttpError('Plugin asset access denied', actor ? 403 : 401)
  return new Response(
    await readVerifiedPluginAsset(digest, item.manifest, asset),
    {
      headers: {
        'Content-Type': asset.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    }
  )
})
