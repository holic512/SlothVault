'use client'

/**
 * @file use-solana-wallet.ts
 * @project SlothVault
 * @module Solana Wallet Capability Boundary
 * @description Exposes the application-level Solana wallet capabilities used by authentication and evidence business flows.
 * @logic Expose awaited connections and account-stable message signing, retain network eligibility and Phantom-only Devnet evidence, and bind prepared transaction signatures to their target chain.
 * @dependencies @solana/wallet-adapter-react, wallet-connection-provider, wallet-connection, solana-transaction
 * @index_tags solana,wallet,adapter,wallet-standard,authentication,evidence,client
 * @author holic512
 */
import { useCallback } from 'react'

import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletConnection } from './wallet-connection-provider'
import { connectedWallet, signWalletMessage, WalletConnectionError } from './wallet-connection'

import { assertWalletEvidenceNetwork, canWalletSignEvidence, signPreparedSolanaTransaction } from '@/components/wallet/solana-transaction'
import type { EvidenceNetwork } from '@/lib/evidence-diagnostics'

export function useSolanaWallet() {
  const { connected, publicKey, signMessage, signTransaction, wallet } = useWallet()
  const { pickerOpen, openWalletSelector, requestConnection, currentAdapter } = useWalletConnection()
  const address = publicKey?.toBase58() ?? null

  const signLoginMessage = useCallback(async (message: string) => {
    const adapter = currentAdapter()
    if (!adapter) throw new WalletConnectionError('WALLET_DISCONNECTED')
    return signWalletMessage(connectedWallet(adapter), message, currentAdapter)
  }, [currentAdapter])

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
    pickerOpen,
    openWalletSelector,
    requestConnection,
    currentAdapter,
    signLoginMessage,
    signPreparedTransaction,
  }
}
