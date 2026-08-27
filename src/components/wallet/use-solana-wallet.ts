'use client'

/**
 * @file use-solana-wallet.ts
 * @project SlothVault
 * @module Solana Wallet Capability Boundary
 * @description Exposes the application-level Solana wallet capabilities used by authentication and evidence business flows.
 * @logic Hide Wallet Adapter and Wallet Standard details behind address, selector, message-signing, and prepared-transaction-signing operations so business components do not depend on a wallet vendor or injected provider shape.
 * @dependencies @solana/wallet-adapter-react, @solana/wallet-adapter-react-ui, bs58, solana-transaction
 * @index_tags solana,wallet,adapter,wallet-standard,authentication,evidence,client
 * @author holic512
 */
import { useCallback } from 'react'

import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import bs58 from 'bs58'

import { signPreparedSolanaTransaction } from '@/components/wallet/solana-transaction'

export function useSolanaWallet() {
  const { connected, publicKey, signMessage, signTransaction } = useWallet()
  const { setVisible } = useWalletModal()
  const address = publicKey?.toBase58() ?? null
  const openWalletSelector = useCallback(() => setVisible(true), [setVisible])

  const signLoginMessage = useCallback(async (message: string) => {
    if (!address || !signMessage) throw new Error('当前钱包不支持消息签名')
    const signature = await signMessage(new TextEncoder().encode(message))
    return { address, signature: bs58.encode(signature) }
  }, [address, signMessage])

  const signPreparedTransaction = useCallback(
    (transactionBase64: string) => signPreparedSolanaTransaction(transactionBase64, signTransaction),
    [signTransaction],
  )

  return {
    address,
    connected,
    canSignMessage: Boolean(signMessage),
    canSignTransaction: Boolean(signTransaction),
    openWalletSelector,
    signLoginMessage,
    signPreparedTransaction,
  }
}
