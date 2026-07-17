/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Solana Tree Estimate API
 * @description Returns precise account-compression sizes and RPC-backed or offline rent estimates.
 * @logic Authenticate, validate optional supported tree dimensions, and calculate presets with the locked account-compression package.
 * @dependencies admin session, zod, admin-solana-trees service
 * @index_tags api,admin,solana,merkle-tree,estimate
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { estimateMerkleTree } from '@/server/services/admin-solana-trees'
import { getSolanaNetwork } from '@/server/services/system-config'

const estimateSchema = z.object({
  network: z.enum(['mainnet', 'devnet']).optional(),
  maxDepth: z.number().int().min(1).max(30).optional(),
  maxBufferSize: z.number().int().positive().max(2048).optional(),
  canopyDepth: z.number().int().min(0).max(30).optional(),
})

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, estimateSchema)
  return apiOk(
    await estimateMerkleTree({
      ...body,
      network: body.network ?? (await getSolanaNetwork()),
    }),
  )
})

