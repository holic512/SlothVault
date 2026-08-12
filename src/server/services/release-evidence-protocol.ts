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

import { createHash } from 'node:crypto'

import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import bs58 from 'bs58'

import { HttpError } from '@/server/http/errors'
import type { SolanaNetwork } from '@/server/services/system-config'

export const RELEASE_EVIDENCE_PROTOCOL = 'slothvault.release'
export const RELEASE_EVIDENCE_PROTOCOL_VERSION = 1
export const MEMO_PROGRAM_ID = new PublicKey(
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
)
const MAX_TRANSACTION_BYTES = 1_232

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
  return new Transaction({
    feePayer: input.signer,
    blockhash: input.blockhash,
    lastValidBlockHeight: input.lastValidBlockHeight,
  }).add(
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [{ pubkey: input.signer, isSigner: true, isWritable: false }],
      data: Buffer.from(input.memo, 'utf8'),
    }),
  )
}

export function evidenceMessageHash(transaction: Transaction) {
  return createHash('sha256').update(transaction.serializeMessage()).digest('hex')
}

export function serializePreparedEvidence(transaction: Transaction) {
  return transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64')
}

export function parseSignedEvidence(value: string) {
  let bytes: Buffer
  try {
    bytes = Buffer.from(value, 'base64')
  } catch {
    throw new HttpError('Invalid signed evidence transaction', 400, 400)
  }
  if (!bytes.length || bytes.length > MAX_TRANSACTION_BYTES) {
    throw new HttpError('Invalid signed evidence transaction', 400, 400)
  }
  try {
    return Transaction.from(bytes)
  } catch {
    throw new HttpError('Invalid signed evidence transaction', 400, 400)
  }
}

export function assertSignedEvidenceTransaction(input: {
  transaction: Transaction
  memo: string
  signerAddress: string
  messageHash: string
}) {
  const { transaction } = input
  const signer = new PublicKey(input.signerAddress)
  if (evidenceMessageHash(transaction) !== input.messageHash) {
    throw new HttpError('Signed transaction message does not match the prepared evidence', 409, 409)
  }
  if (!transaction.feePayer?.equals(signer) || transaction.instructions.length !== 1) {
    throw new HttpError('Signed transaction has an invalid evidence structure', 400, 400)
  }
  const instruction = transaction.instructions[0]
  const validSigner = instruction.keys.length === 1 &&
    instruction.keys[0].pubkey.equals(signer) &&
    instruction.keys[0].isSigner
  if (
    !instruction.programId.equals(MEMO_PROGRAM_ID) ||
    !validSigner ||
    instruction.data.toString('utf8') !== input.memo
  ) {
    throw new HttpError('Signed transaction contains unexpected instructions', 400, 400)
  }
  if (!transaction.verifySignatures(true) || !transaction.signature) {
    throw new HttpError('Evidence transaction signature is invalid', 400, 400)
  }
  return bs58.encode(transaction.signature)
}
