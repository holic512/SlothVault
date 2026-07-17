/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Solana Tree Prepare API
 * @description Prepares a Merkle Tree creation transaction for the connected administrator wallet.
 * @logic Authenticate, validate supported dimensions and payer input, partially sign server-owned accounts, and return a five-minute opaque session token.
 * @dependencies admin session, zod, admin-solana-trees service
 * @index_tags api,admin,solana,merkle-tree,prepare
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { prepareMerkleTree } from '@/server/services/admin-solana-trees'

const prepareTreeSchema = z.object({
  name: z.string().trim().min(1).max(128),
  maxDepth: z.number().int().min(1).max(30),
  maxBufferSize: z.number().int().positive().max(2048),
  canopyDepth: z.number().int().min(0).max(30).default(0),
  payerAddress: z.string().trim().min(32).max(64),
  network: z.enum(['mainnet', 'devnet']),
})

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, prepareTreeSchema)
  return apiOk(await prepareMerkleTree(body), 'Merkle Tree transaction prepared')
})

