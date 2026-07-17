/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Version API
 * @description Applies authenticated bulk changes to project versions.
 * @logic Accept decimal-string IDs only, validate move targets, and restore deleted versions as active.
 * @dependencies admin session, HTTP route helpers, Prisma ProjectVersion model, admin catalog service
 * @index_tags api,admin,project-version,batch,restore
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
  parseJsonDecimalId,
  parseJsonDecimalIds,
} from '@/server/services/admin-catalog'

const batchProjectVersionSchema = z.object({
  action: z.unknown().optional(),
  ids: z.unknown().optional(),
  status: z.unknown().optional(),
  projectId: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, batchProjectVersionSchema)
  const action = typeof body.action === 'string' ? body.action : ''
  const ids = parseJsonDecimalIds(body.ids)
  if (!action || !ids) throw new HttpError('Missing action or ids', 400, 400)

  if (action === 'delete') {
    const result = await prisma.projectVersion.updateMany({
      where: { id: { in: ids } },
      data: { isDeleted: true, status: 0, updatedAt: new Date() },
    })
    return apiOk({ count: result.count })
  }

  if (action === 'restore') {
    const result = await prisma.projectVersion.updateMany({
      where: { id: { in: ids } },
      data: { isDeleted: false, status: 1, updatedAt: new Date() },
    })
    return apiOk({ count: result.count })
  }

  if (action === 'setStatus') {
    const status = optionalIntegerValue(body.status)
    if (status === null) throw new HttpError('Missing status', 400, 400)
    const result = await prisma.projectVersion.updateMany({
      where: { id: { in: ids }, isDeleted: false },
      data: { status, updatedAt: new Date() },
    })
    return apiOk({ count: result.count })
  }

  if (action === 'moveToProject') {
    const projectId = parseJsonDecimalId(body.projectId, 'projectId')
    const project = await prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
    })
    if (!project) throw new HttpError('Project not found', 404, 404)

    const result = await prisma.projectVersion.updateMany({
      where: { id: { in: ids }, isDeleted: false },
      data: { projectId, updatedAt: new Date() },
    })
    return apiOk({ count: result.count })
  }

  throw new HttpError('Invalid action', 400, 400)
})
