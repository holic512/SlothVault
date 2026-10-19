/**
 * @file route.ts
 * @project SlothVault
 * @module Plugin Instance API
 * @description Provides details, configuration and explicit installation/lifecycle actions.
 * @logic Require admin and same-origin writes; compare staged package identity before executing any lifecycle.
 * @dependencies Plugin Manager, encrypted config, shared HTTP validation
 * @index_tags plugins,admin,api,lifecycle,config
 * @author holic512
 */
import { z } from 'zod'
import { pluginIdSchema } from '@slothvault/plugin-sdk/protocol'
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { readJson } from '@/server/http/request'
import { isSameOriginRequest } from '@/server/http/same-origin'
import { HttpError } from '@/server/http/errors'
import { initializePlugins, installPlugin, pluginDetails, retryPlugin, rollbackPlugin, savePluginConfig, setPluginEnabled, uninstallPlugin } from '@/server/plugins/manager'
import { stagedPackageBytes, verifyPluginPackage } from '@/server/plugins/packages'
import { prisma } from '@/server/prisma'
import { ensureCompiledPlugin } from '@/server/plugins/compiler'
import { withMaintenanceLock } from '@/server/services/maintenance-lock'
import { githubRepository } from '@/server/plugins/sources'
export const dynamic = 'force-dynamic'
type Params = { id: string }
export const GET = defineRoute<Params>(async (request, context) => { await requireAdminSession(request); return apiOk(await pluginDetails(pluginIdSchema.parse((await context.params).id))) }, { cacheControl: 'private, no-store' })
export const PATCH = defineRoute<Params>(async (request, context) => {
  const session = await requireAdminSession(request); if (!isSameOriginRequest(request)) throw new HttpError('Same-origin request required', 403)
  const body = await readJson(request, z.object({ config: z.record(z.string(), z.unknown()) }).strict(), { maxBytes: 64 * 1024 })
  await savePluginConfig(pluginIdSchema.parse((await context.params).id), body.config, session.userId); return apiOk(null)
})
export const POST = defineRoute<Params>(async (request, context) => {
  const session = await requireAdminSession(request); if (!isSameOriginRequest(request)) throw new HttpError('Same-origin request required', 403)
  const id = pluginIdSchema.parse((await context.params).id)
  const body = await readJson(request, z.object({ action: z.enum(['install', 'enable', 'disable', 'retry', 'uninstall', 'rollback']), digest: z.string().regex(/^[a-f0-9]{64}$/).optional(), trusted: z.boolean().optional(), source: z.string().nullable().optional(), deleteData: z.boolean().default(false), confirmPluginId: z.string().optional() }).strict(), { maxBytes: 4096 })
  await withMaintenanceLock('exclusive', initializePlugins)
  if (body.action === 'install') {
    if (!body.digest || body.trusted !== true) throw new HttpError('Verified package and full trust confirmation required', 400)
    const bytes = await stagedPackageBytes(body.digest, id), verified = await verifyPluginPackage(bytes)
    if (verified.manifest.id !== id || verified.digest !== body.digest) throw new HttpError('Staged package identity mismatch', 400)
    const before = await prisma.pluginInstallation.findUnique({ where: { pluginId: id }, select: { generation: true } })
    await ensureCompiledPlugin(verified.digest, verified.manifest)
    return apiOk(await withMaintenanceLock('exclusive', () => installPlugin(bytes, { trusted: true, actorUserId: session.userId, expectedGeneration: before?.generation ?? 0, source: body.source ? githubRepository(body.source) : undefined })))
  }
  await withMaintenanceLock('exclusive', async () => {
  if (body.action === 'uninstall') await uninstallPlugin(id, { ...body, actorUserId: session.userId })
  else if (body.action === 'retry') await retryPlugin(id, session.userId)
  else if (body.action === 'rollback') await rollbackPlugin(id, session.userId)
  else await setPluginEnabled(id, body.action !== 'disable', session.userId)
  })
  return apiOk(null)
}, { lockMode: 'none', cacheControl: 'private, no-store' })
