/**
 * @file route.ts
 * @project SlothVault
 * @module Admin System Homepage API
 * @description Reads the current editable system homepage or creates a new homepage revision.
 * @logic Use the newest non-deleted record as the admin/public editing target and preserve explicit status control.
 * @dependencies admin session, Prisma SystemHomepage model, admin content service
 * @index_tags api,admin,system-homepage,get,create
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'
import { integerValue } from '@/server/services/admin-catalog'
import { systemHomepageDto } from '@/server/services/admin-content'

const createHomepageSchema = z.object({
  content: z.unknown().optional(),
  status: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  const homepage = await prisma.systemHomepage.findFirst({
    where: { isDeleted: false },
    orderBy: { id: 'desc' },
  })
  if (!homepage) throw new HttpError('Not Found', 404, 404)
  return apiOk(systemHomepageDto(homepage))
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, createHomepageSchema)
  if (typeof body.content !== 'string') throw new HttpError('Invalid content', 400, 400)
  const homepage = await prisma.systemHomepage.create({
    data: { content: body.content, status: integerValue(body.status, 1) },
  })
  return apiOk(systemHomepageDto(homepage), 'created', 201)
})
