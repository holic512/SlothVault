/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Homepage API
 * @description Reads, updates/restores, or deletes a project homepage record.
 * @logic Validate decimal IDs, allow soft-delete recovery, and map Prisma missing records to HTTP 404.
 * @dependencies admin session, Prisma ProjectHome model, admin content service
 * @index_tags api,admin,project-home,update,restore,delete
 * @author holic512
 */
import type { Prisma } from '@generated/prisma/client'
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'
import { hasPrismaCode, legacyBoolean, optionalIntegerValue, parseDecimalId } from '@/server/services/admin-catalog'
import { projectHomeDto, requireActiveProject } from '@/server/services/admin-content'

const updateHomeSchema = z.object({
  content: z.unknown().optional(),
  status: z.unknown().optional(),
  isDeleted: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const home = await prisma.projectHome.findUnique({ where: { id } })
  if (!home) throw new HttpError('Not Found', 404, 404)
  return apiOk(projectHomeDto(home))
})

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const body = await readJson(request, updateHomeSchema)
  const existing = await prisma.projectHome.findUnique({ where: { id } })
  if (!existing) throw new HttpError('Not Found', 404, 404)
  if (body.isDeleted === false) {
    await prisma.$transaction((tx) => requireActiveProject(tx, existing.projectId))
  }

  const data: Prisma.ProjectHomeUpdateInput = { updatedAt: new Date() }
  if (typeof body.content === 'string') data.content = body.content
  const status = optionalIntegerValue(body.status)
  if (status !== null) data.status = status
  if (typeof body.isDeleted === 'boolean') data.isDeleted = body.isDeleted
  if (Object.keys(data).length === 1) throw new HttpError('No fields to update', 400, 400)

  try {
    const home = await prisma.projectHome.update({ where: { id }, data })
    return apiOk(projectHomeDto(home))
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
})

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const hard = legacyBoolean(request.nextUrl.searchParams.get('hard'))
  try {
    if (hard) await prisma.projectHome.delete({ where: { id } })
    else {
      await prisma.projectHome.update({
        where: { id },
        data: { isDeleted: true, updatedAt: new Date() },
      })
    }
    return apiOk(null, 'deleted')
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
})
