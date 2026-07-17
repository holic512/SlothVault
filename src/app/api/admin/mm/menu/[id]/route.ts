/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Menu API
 * @description Reads, edits/restores, and cascade-deletes one project menu inside a two-level hierarchy.
 * @logic Resolve the current record inside a transaction, prevent cross-project/third-level parents, and make cascade writes atomic.
 * @dependencies admin session, Prisma ProjectMenu model, admin content service
 * @index_tags api,admin,project-menu,update,restore,cascade-delete
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
  integerValue,
  legacyBoolean,
  parseDecimalId,
  parseJsonDecimalId,
} from '@/server/services/admin-catalog'
import {
  normalizeMenuUrl,
  projectMenuDto,
  projectMenuDtoBase,
  validateMenuParent,
} from '@/server/services/admin-content'

const updateMenuSchema = z.object({
  parentId: z.unknown().optional(),
  label: z.unknown().optional(),
  url: z.unknown().optional(),
  isExternal: z.unknown().optional(),
  weight: z.unknown().optional(),
  status: z.unknown().optional(),
  isDeleted: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const menu = await prisma.projectMenu.findUnique({
    where: { id },
    include: {
      children: {
        where: { isDeleted: false },
        orderBy: [{ weight: 'desc' }, { id: 'asc' }],
      },
    },
  })
  if (!menu) throw new HttpError('Not Found', 404, 404)
  return apiOk(projectMenuDto(menu))
})

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const body = await readJson(request, updateMenuSchema)

  const menu = await prisma.$transaction(async (tx) => {
    const current = await tx.projectMenu.findUnique({ where: { id } })
    if (!current) throw new HttpError('Not Found', 404, 404)
    const resultingExternal =
      typeof body.isExternal === 'boolean' ? body.isExternal : current.isExternal
    const resultingUrl =
      body.url !== undefined
        ? normalizeMenuUrl(body.url, resultingExternal)
        : body.isExternal !== undefined
          ? normalizeMenuUrl(current.url, resultingExternal)
          : undefined
    const data: Prisma.ProjectMenuUpdateInput = { updatedAt: new Date() }

    if (body.parentId !== undefined) {
      if (body.parentId === null || body.parentId === '') data.parent = { disconnect: true }
      else {
        const parentId = parseJsonDecimalId(body.parentId, 'parentId')
        const childCount = await tx.projectMenu.count({ where: { parentId: id } })
        if (childCount > 0) {
          throw new HttpError('A menu with children cannot become a child menu', 400, 400)
        }
        await validateMenuParent(tx, { projectId: current.projectId, parentId, currentId: id })
        data.parent = { connect: { id: parentId } }
      }
    }
    if (typeof body.label === 'string') {
      const label = body.label.trim()
      if (!label) throw new HttpError('Label cannot be empty', 400, 400)
      if (label.length > 64) throw new HttpError('Label is too long', 400, 400)
      data.label = label
    }
    if (resultingUrl !== undefined) data.url = resultingUrl
    if (typeof body.isExternal === 'boolean') data.isExternal = body.isExternal
    if (body.weight !== undefined) data.weight = integerValue(body.weight, current.weight)
    if (body.status !== undefined) data.status = integerValue(body.status, current.status)
    if (typeof body.isDeleted === 'boolean') {
      if (!body.isDeleted && current.parentId) {
        const parent = await tx.projectMenu.findFirst({
          where: { id: current.parentId, projectId: current.projectId, isDeleted: false },
        })
        if (!parent) throw new HttpError('Restore the parent menu first', 400, 400)
      }
      data.isDeleted = body.isDeleted
    }
    if (Object.keys(data).length === 1) throw new HttpError('No fields to update', 400, 400)
    return tx.projectMenu.update({ where: { id }, data })
  })
  return apiOk(projectMenuDtoBase(menu))
})

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const hard = legacyBoolean(request.nextUrl.searchParams.get('hard'))

  await prisma.$transaction(async (tx) => {
    const current = await tx.projectMenu.findUnique({ where: { id } })
    if (!current) throw new HttpError('Not Found', 404, 404)
    if (hard) {
      await tx.projectMenu.deleteMany({ where: { parentId: id } })
      await tx.projectMenu.delete({ where: { id } })
    } else {
      const now = new Date()
      await tx.projectMenu.updateMany({
        where: { parentId: id },
        data: { isDeleted: true, updatedAt: now },
      })
      await tx.projectMenu.update({
        where: { id },
        data: { isDeleted: true, updatedAt: now },
      })
    }
  })
  return apiOk(null, 'deleted')
})
