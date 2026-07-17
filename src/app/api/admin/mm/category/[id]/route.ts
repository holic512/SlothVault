/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Category API
 * @description Updates or soft-deletes one category by decimal identifier.
 * @logic Authenticate, validate editable fields and parent version references, then map missing records to HTTP 404.
 * @dependencies admin session, HTTP route helpers, Prisma Category model, admin catalog service
 * @index_tags api,admin,category,update,delete
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
  categoryDto,
  hasPrismaCode,
  optionalIntegerValue,
  parseDecimalId,
  parseJsonDecimalId,
} from '@/server/services/admin-catalog'

const updateCategorySchema = z.object({
  projectVersionId: z.unknown().optional(),
  categoryName: z.unknown().optional(),
  weight: z.unknown().optional(),
  status: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const body = await readJson(request, updateCategorySchema)
  const data: Prisma.CategoryUncheckedUpdateInput = { updatedAt: new Date() }

  if (body.projectVersionId !== undefined) {
    const projectVersionId = parseJsonDecimalId(body.projectVersionId, 'projectVersionId')
    const projectVersion = await prisma.projectVersion.findFirst({
      where: { id: projectVersionId, isDeleted: false },
    })
    if (!projectVersion) throw new HttpError('ProjectVersion not found', 404, 404)
    data.projectVersionId = projectVersionId
  }

  if (typeof body.categoryName === 'string') {
    const categoryName = body.categoryName.trim()
    if (!categoryName) throw new HttpError('Invalid categoryName', 400, 400)
    data.categoryName = categoryName
  }

  const weight = optionalIntegerValue(body.weight)
  if (weight !== null) data.weight = weight
  const status = optionalIntegerValue(body.status)
  if (status !== null) data.status = status

  if (Object.keys(data).length === 1) {
    throw new HttpError('No fields to update', 400, 400)
  }

  try {
    const category = await prisma.category.update({
      where: { id },
      data,
      include: { projectVersion: true },
    })
    return apiOk(categoryDto(category))
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
    await prisma.category.update({
      where: { id },
      data: { isDeleted: true, updatedAt: new Date() },
    })
    return apiOk(null, 'deleted')
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
})
