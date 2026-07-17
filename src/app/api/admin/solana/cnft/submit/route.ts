/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Solana cNFT Submit API
 * @description Validates, submits, and reconciles the administrator-wallet-signed cNFT mint transaction.
 * @logic Authenticate, bind the signed transaction to its opaque prepare context, persist its deterministic signature before broadcast, then derive the final leaf and asset ID only from a confirmed account-compression change-log event.
 * @dependencies admin session, zod, admin-solana-cnfts service
 * @index_tags api,admin,solana,cnft,submit,reconciliation,change-log
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { submitCnft } from '@/server/services/admin-solana-cnfts'

const submitCnftSchema = z.object({
  sessionId: z.string().min(1).max(16_384),
  signedTransactionBase64: z.string().min(1).max(20_000),
})

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, submitCnftSchema)
  const result = await submitCnft(body)
  return apiOk(result.data, result.message)
})
