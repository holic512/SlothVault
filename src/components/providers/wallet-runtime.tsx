'use client'

/**
 * @file wallet-runtime.tsx
 * @project SlothVault
 * @module Solana Wallet
 * @description Hosts the browser-only Solana Wallet Adapter provider hierarchy used by explicit wallet-capable flows.
 * @logic Resolve the configured RPC endpoint, let Wallet Standard discover compatible wallets (such as a compliant installed OKX Wallet Solana provider), reconnect with this application's selected-wallet key when the scoped runtime remounts, and keep signing client-only without application-managed wallet state.
 * @dependencies @solana/wallet-adapter-react, @solana/wallet-adapter-react-ui, @solana/web3.js
 * @index_tags solana,wallet,provider,client-only
 * @author holic512
 */
import { useCallback, useMemo, type ReactNode } from 'react'

import { WalletAdapterNetwork, type Adapter, type WalletError } from '@solana/wallet-adapter-base'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import '@solana/wallet-adapter-react-ui/styles.css'
import { clusterApiUrl } from '@solana/web3.js'

export function WalletRuntime({ children }: { children: ReactNode }) {
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl(WalletAdapterNetwork.Devnet),
    [],
  )
  const wallets = useMemo<Adapter[]>(() => [], [])
  const onError = useCallback((error: WalletError, adapter?: Adapter) => {
    console.warn(`[wallet] ${error.name}: ${error.message}`, adapter?.name)
  }, [])

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider
        wallets={wallets}
        autoConnect
        localStorageKey="slothvault-solana-wallet"
        onError={onError}
      >
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
