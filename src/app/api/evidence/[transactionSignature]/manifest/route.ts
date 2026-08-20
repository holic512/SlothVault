/**
 * @file route.ts
 * @project SlothVault
 * @module Public Note Content Evidence Manifest API
 * @description Downloads the deterministic manifest for a currently public primary note-content credential.
 * @logic Validate the transaction signature, require subject visibility, recompute the stored hash, and return canonical JSON without database identifiers.
 * @dependencies HTTP errors, note-content evidence service
 * @index_tags api,public,evidence,note-content,manifest,download
 * @author holic512
 */
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { getPublicNoteContentEvidenceManifest } from '@/server/services/release-evidence'

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ transactionSignature: string }>(async (_request, context) => {
  const { transactionSignature } = await context.params
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(transactionSignature)) {
    throw new HttpError('Invalid transaction signature', 400, 400)
  }
  const result = await getPublicNoteContentEvidenceManifest(transactionSignature)
  return new Response(JSON.stringify(result.manifest), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="slothvault-note-${result.subjectId}.manifest.json"`,
      'x-content-sha256': result.hash,
    },
  })
}, { lockMode: 'none' })
