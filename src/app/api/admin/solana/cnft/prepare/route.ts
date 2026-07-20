/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Solana cNFT Prepare API
 * @description Reserves Merkle Tree capacity and prepares a tree-authority-partially-signed cNFT mint attempt.
 * @logic Authenticate, validate project/wallet/metadata input, atomically reserve provider-neutral capacity without claiming a final leaf, optionally publish project media, persist expiry context, and return an opaque five-minute session.
 * @dependencies admin session, zod, admin-solana-cnfts service
 * @index_tags api,admin,solana,cnft,prepare,attempt,capacity-lock
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { parseJsonDecimalId } from '@/server/services/admin-catalog'
import { prepareCnft } from '@/server/services/admin-solana-cnfts'

const projectIdSchema = z
  .union([z.string().regex(/^[1-9]\d*$/), z.number().int().positive().safe()])
  .transform((value) => value.toString())

const prepareCnftSchema = z.object({
  projectId: projectIdSchema,
  ownerAddress: z.string().trim().min(32).max(64),
  name: z.string().trim().min(1).max(128),
  symbol: z.string().trim().max(32).optional(),
  description: z.string().trim().max(5_000).optional(),
  useProjectAvatar: z.boolean().default(true),
  metadataUri: z.string().trim().max(500).optional(),
  payerAddress: z.string().trim().min(32).max(64),
  network: z.enum(['mainnet', 'devnet']),
})

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, prepareCnftSchema)
  return apiOk(
    await prepareCnft({
      ...body,
      projectId: parseJsonDecimalId(body.projectId, 'projectId'),
    }),
    'cNFT transaction prepared',
  )
})
