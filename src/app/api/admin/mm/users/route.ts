/**
 * @file route.ts
 * @project SlothVault
 * @module Administrator User API
 * @description Lists and creates conventional user accounts for administrator support and point management.
 * @logic Require the administrator role, parse bounded filters or account input, and return profile/role/balance summaries without password or session data.
 * @dependencies zod, admin session, points service, admin-users service
 * @index_tags api,admin,users,list,create,points
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { createManagedUser } from '@/server/services/admin-users'
import { listUsers } from '@/server/services/points'

const createUserSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_]+$/),
  email: z.string().trim().email().max(255).optional(),
  displayName: z.string().trim().max(80).optional(),
  password: z.string().min(8).max(256),
})

function bounded(value: string | null, fallback: number, max: number) {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new HttpError('Invalid pagination', 400, 400)
  }
  return parsed
}

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  const query = request.nextUrl.searchParams
  return apiOk(await listUsers({
    page: bounded(query.get('page'), 1, 1_000_000),
    pageSize: bounded(query.get('pageSize'), 20, 100),
    keyword: query.get('keyword') || undefined,
  }))
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, createUserSchema)
  return apiOk(await createManagedUser(body), 'created', 201)
})
