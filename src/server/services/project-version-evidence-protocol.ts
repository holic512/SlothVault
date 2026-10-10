/**
 * @file project-version-evidence-protocol.ts
 * @project SlothVault
 * @module Project Version Evidence Protocol
 * @description Binds compact v3 publication snapshots to a single wallet-signed Solana Memo.
 * @logic Serialize immutable publication metadata in fixed order, enforce the actual transaction size before preparation, and share strict message and signature verification with other Memo workflows.
 * @dependencies release-manifest, solana-memo-transaction, @solana/web3.js
 * @index_tags project-version,evidence,manifest,solana,memo,sha256
 * @author holic512
 */
import 'server-only'
import { canonicalReleaseManifest, type ReleaseManifest } from './release-manifest'
import { HttpError } from '@/server/http/errors'
import { buildMemoTransaction } from './solana-memo-transaction'
import type { SolanaNetwork } from './system-config'

export const PROJECT_VERSION_EVIDENCE_SUBJECT = 'PROJECT_VERSION'
export type EvidenceSubjectType = typeof PROJECT_VERSION_EVIDENCE_SUBJECT
export const PROJECT_VERSION_EVIDENCE_PROTOCOL = 'slothvault.project-version'
export function canonicalProjectVersionEvidenceMemo(input: {
  installationId: string; releaseId: string; manifest: ReleaseManifest;
  releaseHash: string; network: SolanaNetwork; signer: string
}) {
  return JSON.stringify({
    protocol: PROJECT_VERSION_EVIDENCE_PROTOCOL, version: 1,
    installationId: input.installationId, releaseId: input.releaseId,
    manifest: JSON.parse(canonicalReleaseManifest(input.manifest)) as ReleaseManifest,
    releaseHash: input.releaseHash, network: input.network, signer: input.signer,
  })
}
export function buildProjectVersionEvidenceTransaction(input: Parameters<typeof buildMemoTransaction>[0]) {
  const transaction = buildMemoTransaction(input)
  try {
    if (transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length > 1_232) throw new Error('Oversized')
  } catch {
    throw new HttpError('Project publication names exceed the single-transaction evidence capacity', 422, 422, { reason: 'EVIDENCE_TOO_LARGE' })
  }
  return transaction
}
export {
  assertSignedMemoTransaction as assertSignedProjectVersionEvidenceTransaction,
  memoTransactionMessageHash as projectVersionEvidenceMessageHash,
  parseSignedMemoTransaction as parseSignedProjectVersionEvidence,
  serializePreparedMemoTransaction as serializePreparedProjectVersionEvidence,
} from './solana-memo-transaction'
