'use client'

/**
 * @file use-solana-wallet.ts
 * @project SlothVault
 * @module Solana Wallet Capability Boundary
 * @description Exposes the application-level Solana wallet capabilities used by authentication and evidence business flows.
 * @logic Expose network signing eligibility from the selected adapter, restrict Devnet evidence to Phantom, and bind every prepared signature to its target chain without changing login signing.
 * @dependencies @solana/wallet-adapter-react, @solana/wallet-adapter-react-ui, bs58, solana-transaction
 * @index_tags solana,wallet,adapter,wallet-standard,authentication,evidence,client
 * @author holic512
 */
import { useCallback } from 'react'

import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import bs58 from 'bs58'

import { assertWalletEvidenceNetwork, canWalletSignEvidence, signPreparedSolanaTransaction } from '@/components/wallet/solana-transaction'
import type { EvidenceNetwork } from '@/lib/evidence-diagnostics'

export function useSolanaWallet() {
  const { connected, publicKey, signMessage, signTransaction, wallet } = useWallet()
  const { setVisible } = useWalletModal()
  const address = publicKey?.toBase58() ?? null
  const openWalletSelector = useCallback(() => setVisible(true), [setVisible])

  const signLoginMessage = useCallback(async (message: string) => {
    if (!address || !signMessage) throw new Error('当前钱包不支持消息签名')
    const signature = await signMessage(new TextEncoder().encode(message))
    return { address, signature: bs58.encode(signature) }
  }, [address, signMessage])

  const signPreparedTransaction = useCallback(
    (transactionBase64: string, network: EvidenceNetwork, attemptId?: string) => signPreparedSolanaTransaction(transactionBase64, network, wallet?.adapter, address, signTransaction, attemptId),
    [wallet?.adapter, address, signTransaction],
  )

  return {
    address,
    connected,
    walletName: wallet?.adapter.name ?? null,
    canSignForNetwork: (network: EvidenceNetwork) => canWalletSignEvidence(wallet?.adapter, address, network),
    assertEvidenceNetwork: (network: EvidenceNetwork) => assertWalletEvidenceNetwork(wallet?.adapter, address, network),
    canSignMessage: Boolean(signMessage),
    canSignTransaction: Boolean(signTransaction),
    openWalletSelector,
    signLoginMessage,
    signPreparedTransaction,
  }
}
