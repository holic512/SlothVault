/**
 * @file wallet-proof.ts
 * @project SlothVault
 * @module Wallet Access Contract
 * @description Defines the exact signed message shared by the React wallet client and Next.js access verifier.
 * @logic Bind a wallet address, project ID, timestamp, and application domain into a deterministic UTF-8 message.
 * @dependencies none
 * @index_tags solana,signature,access-control,contract
 * @author holic512
 */
export const WALLET_PROOF_MAX_AGE_MS = 5 * 60 * 1000

export type WalletProof = {
  address: string
  signature: string
  timestamp: number
}

export function buildWalletAccessMessage(projectId: string, address: string, timestamp: number) {
  return [
    'SlothVault access proof',
    `project:${projectId}`,
    `address:${address}`,
    `timestamp:${timestamp}`,
  ].join('\n')
}
