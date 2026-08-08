/**
 * @file transaction.ts
 * @project SlothVault
 * @module Solana Administration
 * @description Converts prepared Solana transactions to wallet-compatible bytes and returns their signed Base64 payloads.
 * @logic Decode the server payload, ask the connected wallet to sign the transaction, serialize it, and encode the result for submission.
 * @dependencies @solana/web3.js
 * @index_tags admin,solana,transactions,wallet,base64
 * @author holic512
 */
import { Transaction } from '@solana/web3.js'

import type { PrepareTransaction } from './types'

function decodeBase64(value: string) {
  const binary = window.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function encodeBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 8192
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return window.btoa(binary)
}

export async function signPreparedTransaction(
  prepared: PrepareTransaction,
  signTransaction: ((transaction: Transaction) => Promise<Transaction>) | undefined,
) {
  if (!signTransaction) throw new Error('The connected wallet cannot sign transactions')
  const transaction = Transaction.from(decodeBase64(prepared.transactionBase64))
  const signed = await signTransaction(transaction)
  return encodeBase64(signed.serialize())
}
