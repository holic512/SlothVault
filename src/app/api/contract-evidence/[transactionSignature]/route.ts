/**
 * @file route.ts
 * @project SlothVault
 * @module Public Contract Evidence API
 * @description Exposes a privacy-preserving contract-chain receipt and optional live Solana verification.
 * @logic Validate a transaction signature, return only hash-level receipt data, and never expose contract content or participant identity.
 * @dependencies HTTP helpers, contracts service
 * @index_tags api,public,contracts,evidence,verification,privacy
 * @author holic512
 */
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { getPublicContractEvidence, verifyPublicContractEvidence } from '@/server/services/contracts'

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ transactionSignature: string }>(async (request, context) => {
  const { transactionSignature } = await context.params
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(transactionSignature)) {
    throw new HttpError('Invalid transaction signature', 400, 400)
  }
  const stored = await getPublicContractEvidence(transactionSignature)
  if (!stored) throw new HttpError('Contract evidence not found', 404, 404)
  if (request.nextUrl.searchParams.get('live') === '1') {
    return apiOk(await verifyPublicContractEvidence(transactionSignature))
  }
  return apiOk(stored)
})
