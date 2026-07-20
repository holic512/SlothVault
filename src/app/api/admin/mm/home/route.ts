/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Homepage API
 * @description Reads or creates/restores the one homepage record associated with a project.
 * @logic Authenticate, parse identifiers and JSON, delegate homepage persistence, and wrap the stable response.
 * @dependencies admin session, server/http helpers, admin catalog parser, admin content service
 * @index_tags api,admin,project-home,get,upsert
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { parseDecimalId, parseJsonDecimalId } from '@/server/services/admin-catalog'
import {
  createOrRestoreProjectHome,
  getProjectHomeByProjectId,
} from '@/server/services/admin-content'

const createHomeSchema = z.object({
  projectId: z.unknown().optional(),
  content: z.unknown().optional(),
  status: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  const projectIdRaw = request.nextUrl.searchParams.get('projectId')
  if (projectIdRaw === null) throw new HttpError('Missing projectId', 400, 400)
  const projectId = parseDecimalId(projectIdRaw, 'projectId')
  return apiOk(await getProjectHomeByProjectId(projectId))
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, createHomeSchema)
  const projectId = parseJsonDecimalId(body.projectId, 'projectId')
  return apiOk(await createOrRestoreProjectHome(projectId, body), 'created', 201)
})
