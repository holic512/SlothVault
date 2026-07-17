/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Version API
 * @description Updates or soft-deletes one project version by decimal identifier.
 * @logic Authenticate, validate optional changes and parent project references, then map missing records to HTTP 404.
 * @dependencies admin session, HTTP route helpers, Prisma ProjectVersion model, admin catalog service
 * @index_tags api,admin,project-version,update,delete
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
import {
  hasPrismaCode,
  optionalIntegerValue,
  parseDecimalId,
  parseJsonDecimalId,
  projectVersionBaseDto,
  projectVersionDto,
} from '@/server/services/admin-catalog'

const updateProjectVersionSchema = z.object({
  projectId: z.unknown().optional(),
  version: z.unknown().optional(),
  description: z.unknown().optional(),
  weight: z.unknown().optional(),
  status: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const body = await readJson(request, updateProjectVersionSchema)
  const data: Prisma.ProjectVersionUncheckedUpdateInput = { updatedAt: new Date() }

  if (body.projectId !== undefined) {
    const projectId = parseJsonDecimalId(body.projectId, 'projectId')
    const project = await prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
    })
    if (!project) throw new HttpError('Project not found', 404, 404)
    data.projectId = projectId
  }

  if (typeof body.version === 'string') {
    const version = body.version.trim()
    if (!version) throw new HttpError('Invalid version', 400, 400)
    data.version = version
  }

  if (typeof body.description === 'string') {
    data.description = body.description.trim() || null
  }

  const weight = optionalIntegerValue(body.weight)
  if (weight !== null) data.weight = weight
  const status = optionalIntegerValue(body.status)
  if (status !== null) data.status = status

  if (Object.keys(data).length === 1) {
    throw new HttpError('No fields to update', 400, 400)
  }

  try {
    const projectVersion = await prisma.projectVersion.update({
      where: { id },
      data,
      include: { project: true },
    })
    return apiOk(projectVersionDto(projectVersion))
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
})

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)

  try {
    const projectVersion = await prisma.projectVersion.update({
      where: { id },
      data: { isDeleted: true, status: 0, updatedAt: new Date() },
    })
    return apiOk(projectVersionBaseDto(projectVersion))
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
})
