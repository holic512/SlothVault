/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Menu API
 * @description Lists a project's navigation as a flat collection or two-level tree and creates new menu entries.
 * @logic Require an active project, constrain parents to active roots in the same project, and validate internal/external URL contracts.
 * @dependencies admin session, Prisma ProjectMenu model, admin content service
 * @index_tags api,admin,project-menu,list,tree,create
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
  integerValue,
  legacyBoolean,
  parseDecimalId,
  parseJsonDecimalId,
} from '@/server/services/admin-catalog'
import {
  normalizeMenuUrl,
  projectMenuDto,
  projectMenuDtoBase,
  requireActiveProject,
  validateMenuParent,
} from '@/server/services/admin-content'

const createMenuSchema = z.object({
  projectId: z.unknown().optional(),
  parentId: z.unknown().optional(),
  label: z.unknown().optional(),
  url: z.unknown().optional(),
  isExternal: z.unknown().optional(),
  weight: z.unknown().optional(),
  status: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  const projectIdRaw = request.nextUrl.searchParams.get('projectId')
  if (projectIdRaw === null) throw new HttpError('Missing projectId', 400, 400)
  const projectId = parseDecimalId(projectIdRaw, 'projectId')
  const tree = legacyBoolean(request.nextUrl.searchParams.get('tree'))
  const includeDeleted = legacyBoolean(request.nextUrl.searchParams.get('includeDeleted'))
  const project = await prisma.project.findFirst({ where: { id: projectId, isDeleted: false } })
  if (!project) throw new HttpError('Project not found', 404, 404)

  const baseWhere = { projectId, ...(includeDeleted ? {} : { isDeleted: false }) }
  if (tree) {
    const list = await prisma.projectMenu.findMany({
      where: { ...baseWhere, parentId: null },
      include: {
        children: {
          where: includeDeleted ? {} : { isDeleted: false },
          orderBy: [{ weight: 'desc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ weight: 'desc' }, { id: 'asc' }],
    })
    return apiOk(list.map(projectMenuDto))
  }

  const list = await prisma.projectMenu.findMany({
    where: baseWhere,
    orderBy: [{ weight: 'desc' }, { id: 'asc' }],
  })
  return apiOk(list.map(projectMenuDtoBase))
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, createMenuSchema)
  const projectId = parseJsonDecimalId(body.projectId, 'projectId')
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (!label) throw new HttpError('Missing label', 400, 400)
  if (label.length > 64) throw new HttpError('Label is too long', 400, 400)
  const isExternal = body.isExternal === true
  const parentId =
    body.parentId === undefined || body.parentId === null || body.parentId === ''
      ? null
      : parseJsonDecimalId(body.parentId, 'parentId')
  const url = normalizeMenuUrl(body.url, isExternal)

  const menu = await prisma.$transaction(async (tx) => {
    await requireActiveProject(tx, projectId)
    if (parentId) await validateMenuParent(tx, { projectId, parentId })
    return tx.projectMenu.create({
      data: {
        projectId,
        parentId,
        label,
        url,
        isExternal,
        weight: integerValue(body.weight, 0),
        status: integerValue(body.status, 1),
      },
    })
  })
  return apiOk(projectMenuDtoBase(menu), 'created', 201)
})
