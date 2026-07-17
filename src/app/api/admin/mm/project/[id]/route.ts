/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project API
 * @description Reads, updates, and soft-deletes one project by decimal identifier.
 * @logic Authenticate, parse the route ID, validate editable fields, and map missing Prisma records to HTTP 404.
 * @dependencies admin session, HTTP route helpers, Prisma Project model, admin catalog service
 * @index_tags api,admin,project,detail,update,delete
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
  projectDto,
  projectSummaryDto,
} from '@/server/services/admin-catalog'

const updateProjectSchema = z.object({
  projectName: z.unknown().optional(),
  avatar: z.unknown().optional(),
  weight: z.unknown().optional(),
  status: z.unknown().optional(),
  requireAuth: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)

  const project = await prisma.project.findUnique({ where: { id } })
  if (!project) throw new HttpError('Not Found', 404, 404)
  return apiOk(projectDto(project))
})

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const body = await readJson(request, updateProjectSchema)
  const data: Prisma.ProjectUpdateInput = { updatedAt: new Date() }

  if (typeof body.projectName === 'string') {
    const projectName = body.projectName.trim()
    if (!projectName) throw new HttpError('Invalid projectName', 400, 400)
    data.projectName = projectName
  }

  if (body.avatar !== undefined) {
    if (body.avatar !== null && typeof body.avatar !== 'string') {
      throw new HttpError('Invalid avatar', 400, 400)
    }
    data.avatar = body.avatar
  }

  const weight = optionalIntegerValue(body.weight)
  if (weight !== null) data.weight = weight
  const status = optionalIntegerValue(body.status)
  if (status !== null) data.status = status
  if (typeof body.requireAuth === 'boolean') data.requireAuth = body.requireAuth

  if (Object.keys(data).length === 1) {
    throw new HttpError('No fields to update', 400, 400)
  }

  try {
    const project = await prisma.project.update({ where: { id }, data })
    return apiOk(projectDto(project))
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
    const project = await prisma.project.update({
      where: { id },
      data: { isDeleted: true, status: 0, updatedAt: new Date() },
    })
    return apiOk(projectSummaryDto(project))
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
})
