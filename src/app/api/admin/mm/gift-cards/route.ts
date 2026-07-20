/**
 * @file route.ts
 * @project SlothVault
 * @module Administrator Gift Card API
 * @description Issues secure point-card batches and lists aggregate redemption status.
 * @logic Require the administrator role, validate bounded issuance, return plaintext codes only once, and expose only aggregate/hash-safe data afterward.
 * @dependencies zod, admin session, points service
 * @index_tags api,admin,gift-card,issuance,points
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { issueGiftCardBatch, listGiftCardBatches } from '@/server/services/points'

const issueSchema = z.object({
  name: z.string().trim().min(2).max(128),
  points: z.number().int().min(1).max(1_000_000),
  quantity: z.number().int().min(1).max(500),
  expiresAt: z.string().datetime().nullable().optional(),
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
  return apiOk(await listGiftCardBatches(
    bounded(query.get('page'), 1, 1_000_000),
    bounded(query.get('pageSize'), 20, 100),
  ))
})

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  const body = await readJson(request, issueSchema)
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new HttpError('Expiration must be in the future', 400, 400)
  }
  return apiOk(await issueGiftCardBatch({
    ...body,
    expiresAt,
    adminId: session.userId,
  }), 'created', 201)
})
