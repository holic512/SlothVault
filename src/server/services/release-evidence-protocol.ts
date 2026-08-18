/**
 * @file release-evidence-protocol.ts
 * @project SlothVault
 * @module Release Evidence Protocol
 * @description Defines the canonical Solana Memo payload and Solana legacy-message transaction contract for immutable release evidence.
 * @logic Serialize fields in one fixed JSON order, require the publishing wallet as fee payer and memo signer, and reject every message-level deviation before broadcast or verification.
 * @dependencies node:crypto, @solana/web3.js, bs58
 * @index_tags evidence,solana,memo,protocol,transaction,sha256
 * @author holic512
 */
import 'server-only'

import { PublicKey, Transaction } from '@solana/web3.js'

import {
  MEMO_PROGRAM_ID,
  assertSignedMemoTransaction,
  buildMemoTransaction,
  memoTransactionMessageHash,
  parseSignedMemoTransaction,
  serializePreparedMemoTransaction,
} from '@/server/services/solana-memo-transaction'
import type { SolanaNetwork } from '@/server/services/system-config'

export const RELEASE_EVIDENCE_PROTOCOL = 'slothvault.release'
export const RELEASE_EVIDENCE_PROTOCOL_VERSION = 1
export { MEMO_PROGRAM_ID }

export type ReleaseEvidenceMemo = {
  protocol: typeof RELEASE_EVIDENCE_PROTOCOL
  version: typeof RELEASE_EVIDENCE_PROTOCOL_VERSION
  installationId: string
  releaseId: string
  manifestVersion: number
  releaseHash: string
  network: SolanaNetwork
  signer: string
}

export function canonicalEvidenceMemo(input: Omit<ReleaseEvidenceMemo, 'protocol' | 'version'>) {
  return JSON.stringify({
    protocol: RELEASE_EVIDENCE_PROTOCOL,
    version: RELEASE_EVIDENCE_PROTOCOL_VERSION,
    installationId: input.installationId,
    releaseId: input.releaseId,
    manifestVersion: input.manifestVersion,
    releaseHash: input.releaseHash,
    network: input.network,
    signer: input.signer,
  } satisfies ReleaseEvidenceMemo)
}

export function buildEvidenceTransaction(input: {
  memo: string
  signer: PublicKey
  blockhash: string
  lastValidBlockHeight: number
}) {
  return buildMemoTransaction(input)
}

export function evidenceMessageHash(transaction: Transaction) {
  return memoTransactionMessageHash(transaction)
}

export function serializePreparedEvidence(transaction: Transaction) {
  return serializePreparedMemoTransaction(transaction)
}

export function parseSignedEvidence(value: string) {
  return parseSignedMemoTransaction(value)
}

export function assertSignedEvidenceTransaction(input: {
  transaction: Transaction
  memo: string
  signerAddress: string
  messageHash: string
}) {
  return assertSignedMemoTransaction(input)
}
