/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Homepage API
 * @description Reads or creates/restores the one homepage record associated with a project.
 * @logic Authenticate, validate an active project, and use the unique projectId key as an idempotent create-or-restore boundary.
 * @dependencies admin session, Prisma ProjectHome model, admin content service
 * @index_tags api,admin,project-home,get,upsert
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'
import { integerValue, parseDecimalId, parseJsonDecimalId } from '@/server/services/admin-catalog'
import { projectHomeDto, requireActiveProject } from '@/server/services/admin-content'

const createHomeSchema = z.object({
  projectId: z.unknown().optional(),
  content: z.unknown().optional(),
  status: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  const projectIdRaw = request.nextUrl.searchParams.get('projectId')
  if (projectIdRaw === null) throw new HttpError('Missing projectId', 400, 400)
  const projectId = parseDecimalId(projectIdRaw, 'projectId')
  const home = await prisma.projectHome.findUnique({ where: { projectId } })
  if (!home) throw new HttpError('Not Found', 404, 404)
  return apiOk(projectHomeDto(home))
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, createHomeSchema)
  const projectId = parseJsonDecimalId(body.projectId, 'projectId')
  if (typeof body.content !== 'string') throw new HttpError('Missing content', 400, 400)

  const home = await prisma.$transaction(async (tx) => {
    await requireActiveProject(tx, projectId)
    return tx.projectHome.upsert({
      where: { projectId },
      update: {
        content: body.content as string,
        status: integerValue(body.status, 1),
        isDeleted: false,
        updatedAt: new Date(),
      },
      create: {
        projectId,
        content: body.content as string,
        status: integerValue(body.status, 1),
      },
    })
  })
  return apiOk(projectHomeDto(home), 'created', 201)
})
