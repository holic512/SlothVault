/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Release Evidence Prepare API
 * @description Prepares one wallet-signed Solana Memo transaction for an immutable project release.
 * @logic Authenticate the issuer, validate version/network/wallet input, and persist a bounded signing attempt.
 * @dependencies admin session, zod, release-evidence service
 * @index_tags api,admin,evidence,prepare,wallet
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { prepareReleaseEvidence } from '@/server/services/release-evidence'

const schema = z.object({
  projectVersionId: z.coerce.number().int().positive(),
  network: z.enum(['mainnet', 'devnet']),
  signerAddress: z.string().min(32).max(64),
})

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  const body = await readJson(request, schema)
  return apiOk(await prepareReleaseEvidence({ ...body, issuerUserId: session.User.id }))
})
