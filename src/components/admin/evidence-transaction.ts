/**
 * @file evidence-transaction.ts
 * @project SlothVault
 * @module Release Evidence Wallet Transaction
 * @description Bridges server-prepared Solana evidence transactions to the connected wallet.
 * @logic Decode the exact prepared legacy transaction, ask the wallet to sign it without mutation, and serialize it for authenticated submission.
 * @dependencies @solana/web3.js
 * @index_tags evidence,solana,wallet,transaction,base64
 * @author holic512
 */
import { Transaction } from '@solana/web3.js'

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

export async function signEvidenceTransaction(
  transactionBase64: string,
  signTransaction: ((transaction: Transaction) => Promise<Transaction>) | undefined,
) {
  if (!signTransaction) throw new Error('当前钱包不支持交易签名')
  const transaction = Transaction.from(decodeBase64(transactionBase64))
  const signed = await signTransaction(transaction)
  return encodeBase64(signed.serialize())
}
