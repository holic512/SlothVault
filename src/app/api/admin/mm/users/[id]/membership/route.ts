/**
 * @file route.ts
 * @project SlothVault
 * @module Administrator User Membership API
 * @description Reads, replaces, or cancels one user's membership entitlements for support operations.
 * @logic Require an administrator session, validate a future expiry or permanent grant, replace all current grants atomically, and retain revocation history for audit.
 * @dependencies zod, admin session, HTTP route helpers, membership service, admin catalog IDs
 * @index_tags api,admin,user,membership,grant,revoke
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { parseDecimalId } from '@/server/services/admin-catalog'
import {
  getManagedUserMembership,
  replaceManagedUserMembership,
  revokeManagedUserMembership,
} from '@/server/services/membership'

const membershipSchema = z.object({
  membershipLevelId: z.number().int().positive().safe(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id } = await context.params
  return apiOk(await getManagedUserMembership(parseDecimalId(id)))
})

export const PUT = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireAdminSession(request)
  const { id } = await context.params
  const body = await readJson(request, membershipSchema)
  return apiOk(await replaceManagedUserMembership({
    actorUserId: session.userId,
    userId: parseDecimalId(id),
    membershipLevelId: body.membershipLevelId,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
  }))
})

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireAdminSession(request)
  const { id } = await context.params
  return apiOk(await revokeManagedUserMembership({
    actorUserId: session.userId,
    userId: parseDecimalId(id),
  }))
})
