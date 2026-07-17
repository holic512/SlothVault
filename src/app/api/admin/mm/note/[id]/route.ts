/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Note API
 * @description Reads, updates, and soft-deletes one note metadata record.
 * @logic Authenticate, validate decimal IDs and active category ownership, then preserve legacy detail/write DTO shapes.
 * @dependencies admin session, HTTP route helpers, Prisma NoteInfo model, admin notes service
 * @index_tags api,admin,note,detail,update,delete
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
} from '@/server/services/admin-catalog'
import {
  noteDto,
  requireActiveCategory,
} from '@/server/services/admin-notes'

const updateNoteSchema = z.object({
  categoryId: z.unknown().optional(),
  noteTitle: z.unknown().optional(),
  weight: z.unknown().optional(),
  status: z.unknown().optional(),
  isDeleted: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)

  const note = await prisma.noteInfo.findUnique({
    where: { id },
    include: {
      category: {
        include: { projectVersion: { include: { project: true } } },
      },
      _count: { select: { contents: true } },
    },
  })
  if (!note) throw new HttpError('Not Found', 404, 404)
  return apiOk(noteDto(note))
})

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const body = await readJson(request, updateNoteSchema)
  const current = await prisma.noteInfo.findFirst({
    where: { id, category: { isDeleted: false } },
    select: { id: true },
  })
  if (!current) throw new HttpError('Not Found', 404, 404)

  const data: Prisma.NoteInfoUncheckedUpdateInput = { updatedAt: new Date() }
  if (body.categoryId !== undefined) {
    const categoryId = parseJsonDecimalId(body.categoryId, 'categoryId')
    await requireActiveCategory(categoryId)
    data.categoryId = categoryId
  }

  if (typeof body.noteTitle === 'string') {
    const noteTitle = body.noteTitle.trim()
    if (!noteTitle) throw new HttpError('Invalid noteTitle', 400, 400)
    data.noteTitle = noteTitle
  }

  const weight = optionalIntegerValue(body.weight)
  if (weight !== null) data.weight = weight
  const status = optionalIntegerValue(body.status)
  if (status !== null) data.status = status
  if (typeof body.isDeleted === 'boolean') data.isDeleted = body.isDeleted

  if (Object.keys(data).length === 1) {
    throw new HttpError('No fields to update', 400, 400)
  }

  try {
    const note = await prisma.noteInfo.update({
      where: { id },
      data,
      include: { category: true },
    })
    return apiOk(noteDto(note))
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
})

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const current = await prisma.noteInfo.findFirst({
    where: { id, isDeleted: false, category: { isDeleted: false } },
    select: { id: true },
  })
  if (!current) throw new HttpError('Not Found', 404, 404)

  try {
    await prisma.noteInfo.update({
      where: { id },
      data: { isDeleted: true, updatedAt: new Date() },
    })
    return apiOk(null, 'deleted')
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
})
