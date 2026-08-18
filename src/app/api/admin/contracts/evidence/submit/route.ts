/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Contract Evidence Submission API
 * @description Validates and broadcasts an administrator-signed contract Memo transaction.
 * @logic Persist the signed transaction before RPC submission and retain the administrator operation audit.
 * @dependencies Zod, admin session, HTTP helpers, contracts service
 * @index_tags api,admin,contracts,evidence,submit,wallet,solana,audit
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { submitContractEvidence } from '@/server/services/contracts'

const schema = z.object({
  attemptId: z.coerce.number().int().positive(),
  signedTransactionBase64: z.string().min(1).max(4_096),
})

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  const body = await readJson(request, schema)
  return apiOk(await submitContractEvidence({ ...body, issuerUserId: session.User.id }))
})
