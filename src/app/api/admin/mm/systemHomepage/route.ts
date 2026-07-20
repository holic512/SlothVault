/**
 * @file route.ts
 * @project SlothVault
 * @module Admin System Homepage API
 * @description Reads the current editable system homepage or creates a new homepage revision.
 * @logic Authenticate, parse create payloads, delegate homepage persistence, and wrap compatibility responses.
 * @dependencies admin session, server/http helpers, admin content service
 * @index_tags api,admin,system-homepage,get,create
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import {
  createSystemHomepage,
  getSystemHomepage,
} from '@/server/services/admin-content'

const createHomepageSchema = z.object({
  content: z.unknown().optional(),
  status: z.unknown().optional(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  return apiOk(await getSystemHomepage())
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, createHomepageSchema)
  return apiOk(await createSystemHomepage(body), 'created', 201)
})
