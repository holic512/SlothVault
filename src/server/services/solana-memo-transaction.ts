/**
 * @file solana-memo-transaction.ts
 * @project SlothVault
 * @module Solana Memo Transaction Contract
 * @description Provides the reusable legacy Solana Memo transaction shape shared by immutable release and contract evidence.
 * @logic Build a fixed compute budget and one signer-bound Memo, accept historical single-Memo messages, reject altered messages or invalid signatures, and log safe structural differences.
 * @dependencies node:crypto, @solana/web3.js, bs58
 * @index_tags solana,memo,transaction,signature,evidence,reusable
 * @author holic512
 */
import 'server-only'

import { createHash } from 'node:crypto'

import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import bs58 from 'bs58'

import { HttpError } from '@/server/http/errors'
import { evidenceLog } from '@/lib/evidence-diagnostics'
import { EVIDENCE_COMPUTE_UNIT_LIMIT, evidenceComputeBudgetInstructions, evidenceInstructionSummary } from '@/lib/solana-evidence-instructions'

export const MEMO_PROGRAM_ID = new PublicKey(
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
)

const MAX_TRANSACTION_BYTES = 1_232

export function buildMemoTransaction(input: {
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
    ...evidenceComputeBudgetInstructions(),
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [{ pubkey: input.signer, isSigner: true, isWritable: false }],
      data: Buffer.from(input.memo, 'utf8'),
    }),
  )
}

export function memoTransactionMessageHash(transaction: Transaction) {
  return createHash('sha256').update(transaction.serializeMessage()).digest('hex')
}

export function serializePreparedMemoTransaction(transaction: Transaction) {
  return transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64')
}

export function parseSignedMemoTransaction(value: string) {
  let bytes: Buffer
  try {
    bytes = Buffer.from(value, 'base64')
  } catch {
    throw new HttpError('Invalid signed evidence transaction', 400, 400, { reason: 'EVIDENCE_TRANSACTION_INVALID' })
  }
  if (!bytes.length || bytes.length > MAX_TRANSACTION_BYTES) {
    throw new HttpError('Invalid signed evidence transaction', 400, 400, { reason: 'EVIDENCE_TRANSACTION_INVALID' })
  }
  try {
    return Transaction.from(bytes)
  } catch {
    throw new HttpError('Invalid signed evidence transaction', 400, 400, { reason: 'EVIDENCE_TRANSACTION_INVALID' })
  }
}

export function assertSignedMemoTransaction(input: {
  transaction: Transaction
  memo: string
  signerAddress: string
  messageHash: string
  recentBlockhash?: string
  logContext?: Parameters<typeof evidenceLog>[1]
}) {
  const { transaction } = input
  const signer = new PublicKey(input.signerAddress)
  const actualMessageHash = memoTransactionMessageHash(transaction)
  if (actualMessageHash !== input.messageHash) {
    evidenceLog('submit.message_mismatch', { ...input.logContext,
      expectedMessageHash: input.messageHash, actualMessageHash,
      blockhashChanged: input.recentBlockhash === undefined ? undefined : transaction.recentBlockhash !== input.recentBlockhash,
      feePayerChanged: !transaction.feePayer?.equals(signer),
      actualInstructionCount: transaction.instructions.length,
      actualInstructions: evidenceInstructionSummary(transaction.instructions),
    }, true)
    throw new HttpError('Signed transaction message does not match the prepared evidence', 409, 409, { reason: 'EVIDENCE_MESSAGE_MISMATCH' })
  }
  // Historical attempts contain just a Memo. New attempts contain the exact
  // fixed budget pair followed by a Memo. Preserve the earlier 200,000-unit
  // shape for historical verification; every shape must match its stored hash.
  const instructions = transaction.instructions
  const hasFixedBudget = instructions.length === 3 && [EVIDENCE_COMPUTE_UNIT_LIMIT, 200_000].some(units => evidenceComputeBudgetInstructions(units).every((expected, index) => {
    const actual = instructions[index]
    return actual.programId.equals(expected.programId) && actual.keys.length === 0 && actual.data.equals(expected.data)
  }))
  if (!transaction.feePayer?.equals(signer) || (instructions.length !== 1 && !hasFixedBudget)) {
    throw new HttpError('Signed transaction has an invalid evidence structure', 400, 400, { reason: 'EVIDENCE_STRUCTURE_INVALID' })
  }
  const instruction = instructions[instructions.length - 1]
  const validSigner = instruction.keys.length === 1 &&
    instruction.keys[0].pubkey.equals(signer) &&
    instruction.keys[0].isSigner
  if (
    !instruction.programId.equals(MEMO_PROGRAM_ID) ||
    !validSigner ||
    instruction.data.toString('utf8') !== input.memo
  ) {
    throw new HttpError('Signed transaction contains unexpected instructions', 400, 400, { reason: 'EVIDENCE_STRUCTURE_INVALID' })
  }
  if (!transaction.verifySignatures(true) || !transaction.signature) {
    throw new HttpError('Evidence transaction signature is invalid', 400, 400, { reason: 'EVIDENCE_SIGNATURE_INVALID' })
  }
  return bs58.encode(transaction.signature)
}
