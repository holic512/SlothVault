/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Evidence Hash Sync API
 * @description Recovers an existing site evidence receipt from a finalized Solana transaction hash.
 * @logic Require an administrator, validate network/address/hash input, and verify chain facts against a stored signing attempt without broadcasting.
 * @dependencies admin session, zod, HTTP helpers, release-evidence service
 * @index_tags api,admin,evidence,sync,solana,recovery
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { syncReleaseEvidenceBySignature } from '@/server/services/release-evidence'

const schema = z.object({
  network: z.enum(['mainnet', 'devnet']),
  signerAddress: z.string().trim().min(32).max(44),
  transactionSignature: z.string().trim().min(64).max(88),
})

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  const body = await readJson(request, schema)
  return apiOk(await syncReleaseEvidenceBySignature({ ...body, issuerUserId: session.User.id }))
})
