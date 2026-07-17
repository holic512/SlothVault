/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project API
 * @description Applies authenticated bulk state changes to projects.
 * @logic Accept decimal-string IDs only, dispatch the requested action, and restore deleted projects as active.
 * @dependencies admin session, HTTP route helpers, Prisma Project model, admin catalog service
 * @index_tags api,admin,project,batch,restore
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'
import {
  optionalIntegerValue,
  optionalLegacyBoolean,
  parseJsonDecimalIds,
} from '@/server/services/admin-catalog'

const batchProjectSchema = z.object({
  action: z.unknown().optional(),
  ids: z.unknown().optional(),
  status: z.unknown().optional(),
  requireAuth: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, batchProjectSchema)
  const action = typeof body.action === 'string' ? body.action : ''
  const ids = parseJsonDecimalIds(body.ids)
  if (!action || !ids) throw new HttpError('Missing action or ids', 400, 400)

  if (action === 'delete') {
    const result = await prisma.project.updateMany({
      where: { id: { in: ids } },
      data: { isDeleted: true, status: 0, updatedAt: new Date() },
    })
    return apiOk({ count: result.count })
  }

  if (action === 'restore') {
    const result = await prisma.project.updateMany({
      where: { id: { in: ids } },
      data: { isDeleted: false, status: 1, updatedAt: new Date() },
    })
    return apiOk({ count: result.count })
  }

  if (action === 'setStatus') {
    const status = optionalIntegerValue(body.status)
    if (status === null) throw new HttpError('Missing status', 400, 400)
    const result = await prisma.project.updateMany({
      where: { id: { in: ids }, isDeleted: false },
      data: { status, updatedAt: new Date() },
    })
    return apiOk({ count: result.count })
  }

  if (action === 'setRequireAuth') {
    const requireAuth = optionalLegacyBoolean(body.requireAuth)
    if (requireAuth === null) throw new HttpError('Missing requireAuth', 400, 400)
    const result = await prisma.project.updateMany({
      where: { id: { in: ids }, isDeleted: false },
      data: { requireAuth, updatedAt: new Date() },
    })
    return apiOk({ count: result.count })
  }

  throw new HttpError('Invalid action', 400, 400)
})
