/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Solana Tree Submit API
 * @description Validates and submits the administrator-wallet-signed Merkle Tree transaction.
 * @logic Authenticate, open the opaque prepare token, bind the signed message to its fee payer/program/tree context, broadcast, confirm, and persist idempotently.
 * @dependencies admin session, zod, admin-solana-trees service
 * @index_tags api,admin,solana,merkle-tree,submit
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { submitMerkleTree } from '@/server/services/admin-solana-trees'

const submitTreeSchema = z.object({
  sessionId: z.string().min(1).max(16_384),
  signedTransactionBase64: z.string().min(1).max(20_000),
})

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, submitTreeSchema)
  const result = await submitMerkleTree(body)
  return apiOk(result.data, result.message)
})

