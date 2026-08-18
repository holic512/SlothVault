/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Contract Evidence Preparation API
 * @description Builds a bounded, signer-bound Solana Memo transaction for an already signed contract.
 * @logic Authenticate the administrator, validate the public wallet address, and create a retryable evidence attempt.
 * @dependencies Zod, admin session, HTTP helpers, contracts service
 * @index_tags api,admin,contracts,evidence,prepare,wallet,solana
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { prepareContractEvidence } from '@/server/services/contracts'

const schema = z.object({
  contractId: z.coerce.number().int().positive(),
  network: z.enum(['mainnet', 'devnet']),
  signerAddress: z.string().min(32).max(64),
})

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  const body = await readJson(request, schema)
  return apiOk(await prepareContractEvidence({ ...body, issuerUserId: session.User.id }))
})
