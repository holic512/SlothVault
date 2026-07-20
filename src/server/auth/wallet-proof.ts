/**
 * @file wallet-proof.ts
 * @project SlothVault
 * @module Wallet Authentication
 * @description Verifies that a caller controls the Solana address used for project authorization.
 * @logic Read proof headers, reject stale timestamps, rebuild the canonical message, and verify its Ed25519 signature.
 * @dependencies @solana/web3.js, bs58, tweetnacl, lib/wallet-proof
 * @index_tags wallet,ed25519,signature,security
 * @author holic512
 */
import 'server-only'

import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import type { NextRequest } from 'next/server'
import nacl from 'tweetnacl'

import {
  buildWalletAccessMessage,
  WALLET_PROOF_MAX_AGE_MS,
  type WalletProof,
} from '@/lib/wallet-proof'
import { HttpError } from '@/server/http/errors'

export function readWalletProof(request: NextRequest): WalletProof | null {
  const address = request.headers.get('x-wallet-address')
  const signature = request.headers.get('x-wallet-signature')
  const timestampRaw = request.headers.get('x-wallet-timestamp')

  if (!address && !signature && !timestampRaw) return null
  if (!address || !signature || !timestampRaw) {
    throw new HttpError('Incomplete wallet proof', 401, 401)
  }

  const timestamp = Number(timestampRaw)
  if (!Number.isSafeInteger(timestamp)) {
    throw new HttpError('Invalid wallet proof timestamp', 401, 401)
  }

  return { address, signature, timestamp }
}

export function verifyWalletProof(projectId: number, proof: WalletProof): string {
  if (Math.abs(Date.now() - proof.timestamp) > WALLET_PROOF_MAX_AGE_MS) {
    throw new HttpError('Wallet proof expired', 401, 401)
  }

  let publicKey: PublicKey
  let signature: Uint8Array
  try {
    publicKey = new PublicKey(proof.address)
    signature = bs58.decode(proof.signature)
  } catch {
    throw new HttpError('Invalid wallet proof', 401, 401)
  }

  const message = new TextEncoder().encode(
    buildWalletAccessMessage(projectId.toString(), proof.address, proof.timestamp),
  )
  if (!nacl.sign.detached.verify(message, signature, publicKey.toBytes())) {
    throw new HttpError('Invalid wallet signature', 401, 401)
  }

  return publicKey.toBase58()
}
