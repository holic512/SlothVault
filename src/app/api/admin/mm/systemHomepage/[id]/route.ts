/**
 * @file route.ts
 * @project SlothVault
 * @module Admin System Homepage API
 * @description Updates the Markdown, publication status, or soft-delete state of one system homepage.
 * @logic Validate explicit editable fields and return stable 404 behavior for missing homepage revisions.
 * @dependencies admin session, Prisma SystemHomepage model, admin content service
 * @index_tags api,admin,system-homepage,update
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
import { hasPrismaCode, optionalIntegerValue, parseDecimalId } from '@/server/services/admin-catalog'
import { systemHomepageDto } from '@/server/services/admin-content'

const updateHomepageSchema = z.object({
  content: z.unknown().optional(),
  status: z.unknown().optional(),
  isDeleted: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const id = parseDecimalId(idRaw)
  const body = await readJson(request, updateHomepageSchema)
  const data: Prisma.SystemHomepageUpdateInput = { updatedAt: new Date() }
  if (typeof body.content === 'string') data.content = body.content
  const status = optionalIntegerValue(body.status)
  if (status !== null) data.status = status
  if (typeof body.isDeleted === 'boolean') data.isDeleted = body.isDeleted
  if (Object.keys(data).length === 1) throw new HttpError('No fields to update', 400, 400)

  try {
    const homepage = await prisma.systemHomepage.update({ where: { id }, data })
    return apiOk(systemHomepageDto(homepage))
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
})
