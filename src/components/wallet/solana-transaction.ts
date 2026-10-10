'use client'

/**
 * @file solana-transaction.ts
 * @project SlothVault
 * @module Solana Wallet Transaction Boundary
 * @description Converts a server-prepared Solana transaction into the exact signed payload required by the evidence APIs.
 * @logic Require the selected wallet and target network, pass an explicit chain to Wallet Standard, and verify unchanged message bytes and signatures before returning the signed payload.
 * @dependencies @solana/web3.js, bs58, evidence-diagnostics
 * @index_tags solana,wallet,transaction,signature,evidence,boundary
 * @author holic512
 */
import { Transaction } from '@solana/web3.js'
import type { Adapter, StandardWalletAdapter } from '@solana/wallet-adapter-base'
import bs58 from 'bs58'
import { evidenceLog, EvidenceSigningError, type EvidenceNetwork } from '@/lib/evidence-diagnostics'
import { evidenceInstructionSummary } from '@/lib/solana-evidence-instructions'

export type SolanaTransactionSigner = (transaction: Transaction) => Promise<Transaction>

function isStandardAdapter(adapter: Adapter): adapter is StandardWalletAdapter {
  return 'standard' in adapter && adapter.standard === true && 'wallet' in adapter
}

function decodeBase64(value: string) {
  const binary = globalThis.atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function encodeBase64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192))
  }
  return globalThis.btoa(binary)
}

export function canWalletSignEvidence(adapter: Adapter | null | undefined, address: string | null, network: EvidenceNetwork) {
  if (!adapter?.connected || !address || !adapter.publicKey || adapter.publicKey.toBase58() !== address) return false
  if (network === 'devnet' && adapter.name !== 'Phantom') return false
  if (isStandardAdapter(adapter)) {
    const account = adapter.wallet.accounts.find((item) => item.address === address)
    return Boolean(account?.chains.includes(network === 'devnet' ? 'solana:devnet' : 'solana:mainnet') &&
      account.features.includes('solana:signTransaction') && 'solana:signTransaction' in adapter.wallet.features)
  }
  return 'signTransaction' in adapter && typeof adapter.signTransaction === 'function'
}

export function assertWalletEvidenceNetwork(adapter: Adapter | null | undefined, address: string | null, network: EvidenceNetwork) {
  if (network === 'devnet' && adapter?.name !== 'Phantom') throw new EvidenceSigningError('EVIDENCE_PHANTOM_REQUIRED')
  if (!canWalletSignEvidence(adapter, address, network)) throw new EvidenceSigningError('EVIDENCE_WALLET_UNSUPPORTED')
}

export async function signPreparedSolanaTransaction(
  transactionBase64: string,
  network: EvidenceNetwork,
  adapter: Adapter | null | undefined,
  address: string | null,
  signTransaction: SolanaTransactionSigner | undefined,
  attemptId?: string,
) {
  assertWalletEvidenceNetwork(adapter, address, network)
  if (!signTransaction || !adapter) throw new EvidenceSigningError('EVIDENCE_WALLET_UNSUPPORTED')
  const transaction = Transaction.from(decodeBase64(transactionBase64))
  if (transaction.feePayer?.toBase58() !== address) throw new EvidenceSigningError('EVIDENCE_WALLET_CHANGED')
  const expectedMessage = Uint8Array.from(transaction.serializeMessage())
  const expectedBlockhash = transaction.recentBlockhash
  const expectedPayer = transaction.feePayer.toBase58()
  const expectedInstructionCount = transaction.instructions.length
  const expectedInstructions = evidenceInstructionSummary(transaction.instructions)
  const context = { attemptId, network, walletName: adapter.name }
  const started = performance.now()
  evidenceLog('wallet.sign.request', context)
  let signed: Transaction
  try {
    if (isStandardAdapter(adapter)) {
      const account = adapter.wallet.accounts.find((item) => item.address === address)!
      const features = adapter.wallet.features
      if (!('solana:signTransaction' in features)) throw new EvidenceSigningError('EVIDENCE_WALLET_UNSUPPORTED')
      const feature = features['solana:signTransaction']
      const outputs = await feature.signTransaction({ account,
        chain: network === 'devnet' ? 'solana:devnet' : 'solana:mainnet',
        transaction: decodeBase64(transactionBase64) })
      if (!outputs[0]?.signedTransaction) throw new EvidenceSigningError('EVIDENCE_TRANSACTION_INVALID')
      try { signed = Transaction.from(outputs[0].signedTransaction) }
      catch { throw new EvidenceSigningError('EVIDENCE_TRANSACTION_INVALID') }
    } else signed = await signTransaction(transaction)
  } catch (error) {
    const reason = error instanceof EvidenceSigningError ? error.reason : 'EVIDENCE_WALLET_SIGNATURE_REJECTED'
    evidenceLog('wallet.sign.failed', { ...context, reason, elapsedMs: Math.round(performance.now() - started) }, true)
    throw new EvidenceSigningError(reason)
  }
  const actualMessage = signed.serializeMessage()
  const unchanged = expectedMessage.length === actualMessage.length && expectedMessage.every((byte, index) => byte === actualMessage[index])
  const signatureValid = signed.verifySignatures(true)
  const hash = async (bytes: Uint8Array) => {
    if (!globalThis.crypto?.subtle) return undefined
    try { return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))), (byte) => byte.toString(16).padStart(2, '0')).join('') }
    catch { return undefined }
  }
  evidenceLog('wallet.sign.returned', { ...context, elapsedMs: Math.round(performance.now() - started),
    expectedMessageHash: await hash(expectedMessage), actualMessageHash: await hash(actualMessage),
    blockhashChanged: expectedBlockhash !== signed.recentBlockhash, feePayerChanged: expectedPayer !== signed.feePayer?.toBase58(),
    instructionCountChanged: expectedInstructionCount !== signed.instructions.length,
    expectedInstructionCount, actualInstructionCount: signed.instructions.length,
    expectedInstructions, actualInstructions: evidenceInstructionSummary(signed.instructions),
    signaturePresent: Boolean(signed.signature), signatureValid,
    transactionSignature: signatureValid && signed.signature ? bs58.encode(signed.signature) : null }, !unchanged || !signatureValid)
  if (!unchanged) throw new EvidenceSigningError('EVIDENCE_MESSAGE_MISMATCH')
  if (!signatureValid || !signed.signature) throw new EvidenceSigningError('EVIDENCE_SIGNATURE_INVALID')
  // The provider may have changed account while its signing dialog was open.
  assertWalletEvidenceNetwork(adapter, address, network)
  return encodeBase64(signed.serialize())
}
