'use client'

/**
 * @file solana-transaction.ts
 * @project SlothVault
 * @module Solana Wallet Transaction Boundary
 * @description Converts a server-prepared Solana transaction into the exact signed payload required by the evidence APIs.
 * @logic Decode only the prepared legacy transaction, delegate signing without adding instructions or changing its message, then return a browser-safe base64 encoding for server verification.
 * @dependencies @solana/web3.js
 * @index_tags solana,wallet,transaction,signature,evidence,boundary
 * @author holic512
 */
import { Transaction } from '@solana/web3.js'

export type SolanaTransactionSigner = (transaction: Transaction) => Promise<Transaction>

function decodeBase64(value: string) {
  const binary = window.atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function encodeBase64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192))
  }
  return window.btoa(binary)
}

export async function signPreparedSolanaTransaction(
  transactionBase64: string,
  signTransaction: SolanaTransactionSigner | undefined,
) {
  if (!signTransaction) throw new Error('当前钱包不支持交易签名')
  const transaction = Transaction.from(decodeBase64(transactionBase64))
  const signed = await signTransaction(transaction)
  return encodeBase64(signed.serialize())
}
