/**
 * @file solana-memo-transaction.ts
 * @project SlothVault
 * @module Solana Memo Transaction Contract
 * @description Provides the reusable legacy Solana Memo transaction shape shared by immutable release and contract evidence.
 * @logic Build exactly one signer-bound Memo instruction, serialize unsigned payloads safely, and reject any signed transaction whose message or structure differs from the prepared record.
 * @dependencies node:crypto, @solana/web3.js, bs58
 * @index_tags solana,memo,transaction,signature,evidence,reusable
 * @author holic512
 */
import 'server-only'

import { createHash } from 'node:crypto'

import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import bs58 from 'bs58'

import { HttpError } from '@/server/http/errors'

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

export function assertSignedMemoTransaction(input: {
  transaction: Transaction
  memo: string
  signerAddress: string
  messageHash: string
}) {
  const { transaction } = input
  const signer = new PublicKey(input.signerAddress)
  if (memoTransactionMessageHash(transaction) !== input.messageHash) {
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
