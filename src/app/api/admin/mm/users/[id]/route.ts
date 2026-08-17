/**
 * @file route.ts
 * @project SlothVault
 * @module Administrator User API
 * @description Updates profile and access state or disables one conventional user account.
 * @logic Require an administrator session, validate bounded profile changes, and delegate session-safe account mutations to the administration user service.
 * @dependencies zod, admin session, HTTP route helpers, admin-users service
 * @index_tags api,admin,user,update,disable,session
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { parseDecimalId } from '@/server/services/admin-catalog'
import { disableManagedUser, updateManagedUser } from '@/server/services/admin-users'

const updateUserSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_]+$/).optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  displayName: z.string().trim().max(80).nullable().optional(),
  status: z.union([z.literal(0), z.literal(1)]).optional(),
}).refine((value) => Object.keys(value).length > 0)

export const dynamic = 'force-dynamic'

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const userId = parseDecimalId(idRaw)
  const values = await readJson(request, updateUserSchema)
  return apiOk(await updateManagedUser({ actorUserId: session.userId, userId, values }))
})

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireAdminSession(request)
  const { id: idRaw } = await context.params
  const userId = parseDecimalId(idRaw)
  return apiOk(await disableManagedUser({ actorUserId: session.userId, userId }))
})
