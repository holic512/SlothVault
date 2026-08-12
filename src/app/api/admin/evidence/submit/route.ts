/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Release Evidence Submit API
 * @description Validates, persists, broadcasts, and begins reconciliation of a wallet-signed evidence transaction.
 * @logic Bind the signed payload to its issuer-owned prepare attempt and delegate signature-first submission.
 * @dependencies admin session, zod, release-evidence service
 * @index_tags api,admin,evidence,submit,reconciliation
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { submitReleaseEvidence } from '@/server/services/release-evidence'

const schema = z.object({
  attemptId: z.coerce.number().int().positive(),
  signedTransactionBase64: z.string().min(1).max(4_096),
})

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  const body = await readJson(request, schema)
  return apiOk(await submitReleaseEvidence({ ...body, issuerUserId: session.User.id }))
})
