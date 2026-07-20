/**
 * @file route.ts
 * @project SlothVault
 * @module Administrator Point Adjustment API
 * @description Adds or removes user points while preserving a complete administrator-attributed ledger entry.
 * @logic Require the administrator role, validate a non-zero bounded adjustment, prevent negative balances, and commit balance plus ledger atomically.
 * @dependencies zod, admin session, points service
 * @index_tags api,admin,user,points,adjustment
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { adjustUserPoints } from '@/server/services/points'

const adjustmentSchema = z.object({
  userId: z.number().int().positive().safe(),
  amount: z.number().int().min(-1_000_000).max(1_000_000).refine((value) => value !== 0),
  description: z.string().trim().min(2).max(255),
})

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  const body = await readJson(request, adjustmentSchema)
  return apiOk(await adjustUserPoints({ ...body, adminId: session.userId }))
})
