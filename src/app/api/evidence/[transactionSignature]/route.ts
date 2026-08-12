/**
 * @file route.ts
 * @project SlothVault
 * @module Public Release Evidence API
 * @description Returns stored release evidence and an optional real-time finalized-chain verification.
 * @logic Validate the signature path, preserve public verification when source content is hidden, and avoid exposing private RPC configuration.
 * @dependencies HTTP route helpers, release-evidence service
 * @index_tags api,public,evidence,verification,solana
 * @author holic512
 */
import { defineRoute } from '@/server/http/handler'
import { HttpError } from '@/server/http/errors'
import { apiOk } from '@/server/http/response'
import {
  getPublicReleaseEvidence,
  verifyPublicReleaseEvidence,
} from '@/server/services/release-evidence'

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ transactionSignature: string }>(async (request, context) => {
  const { transactionSignature } = await context.params
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(transactionSignature)) {
    throw new HttpError('Invalid transaction signature', 400, 400)
  }
  const stored = await getPublicReleaseEvidence(transactionSignature)
  if (!stored) throw new HttpError('Release evidence not found', 404, 404)
  if (request.nextUrl.searchParams.get('live') === '1') {
    return apiOk(await verifyPublicReleaseEvidence(transactionSignature))
  }
  return apiOk({ evidence: stored })
}, { lockMode: 'none' })
