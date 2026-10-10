/**
 * @file route.ts
 * @project SlothVault
 * @module Public Project Version Evidence Manifest API
 * @description Downloads the same canonical v3 publication snapshot used by project-version evidence.
 * @logic Validate the transaction signature, require subject visibility, recompute the stored hash, and return canonical JSON without database identifiers.
 * @dependencies HTTP errors, release evidence service, manifest response
 * @index_tags api,public,evidence,project-version,manifest,download
 * @author holic512
 */
import { releaseManifestResponse } from '@/server/http/manifest-response'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { getPublicReleaseEvidenceManifest } from '@/server/services/release-evidence'
import { getRequestViewer } from '@/server/auth/viewer'

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ transactionSignature: string }>(async (request, context) => {
  const { transactionSignature } = await context.params
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(transactionSignature)) {
    throw new HttpError('Invalid transaction signature', 400, 400)
  }
  const result = await getPublicReleaseEvidenceManifest(transactionSignature, await getRequestViewer(request))
  return releaseManifestResponse(request, result)
}, { cacheControl: 'private, no-store' })

export async function HEAD(request: Parameters<typeof GET>[0], context: Parameters<typeof GET>[1]) {
  const response = await GET(request, context)
  return new Response(null, { status: response.status, headers: response.headers })
}
