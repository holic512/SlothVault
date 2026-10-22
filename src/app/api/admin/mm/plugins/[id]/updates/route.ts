/**
 * @file route.ts
 * @project SlothVault
 * @module Plugin Update API
 * @description Exposes administrator-only, read-only stable release checks.
 * @logic Resolve the stored source and version before bounded discovery without holding the maintenance lock over network I/O.
 * @dependencies admin session, prisma, plugin updates
 * @index_tags plugins,updates,admin,api
 * @author holic512
 */
import { pluginIdSchema } from '@slothvault/plugin-sdk/protocol'
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { HttpError } from '@/server/http/errors'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'
import { checkPluginUpdate } from '@/server/plugins/updates'
export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const pluginId = pluginIdSchema.parse((await context.params).id)
  const item = await prisma.pluginInstallation.findUnique({ where: { pluginId }, select: { pluginId: true, version: true, source: true, installed: true } })
  if (!item?.installed) throw new HttpError('Plugin is not installed', 404)
  return apiOk(await checkPluginUpdate(item))
}, { cacheControl: 'private, no-store', lockMode: 'none' })
