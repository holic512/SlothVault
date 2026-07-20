/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Menu API
 * @description Lists a project's navigation as a flat collection or two-level tree and creates new menu entries.
 * @logic Authenticate, parse list/create inputs, delegate menu invariants and persistence, and wrap compatibility responses.
 * @dependencies admin session, server/http helpers, admin catalog parser, admin content service
 * @index_tags api,admin,project-menu,list,tree,create
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import {
  legacyBoolean,
  parseDecimalId,
  parseJsonDecimalId,
} from '@/server/services/admin-catalog'
import {
  createProjectMenu,
  listProjectMenus,
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
  return apiOk(await listProjectMenus({ projectId, tree, includeDeleted }))
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, createMenuSchema)
  const projectId = parseJsonDecimalId(body.projectId, 'projectId')
  return apiOk(await createProjectMenu(projectId, body), 'created', 201)
})
