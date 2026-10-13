'use client'

/**
 * @file wallet-runtime.tsx
 * @project SlothVault
 * @module Solana Wallet
 * @description Hosts the browser-only Solana Wallet Adapter provider hierarchy used by explicit wallet-capable flows.
 * @logic Resolve the configured RPC endpoint, let Wallet Standard discover compatible wallets (such as a compliant installed OKX Wallet Solana provider), reconnect with the scoped selected-wallet key, and host one shared picker with explicit awaitable connection requests without authenticating on reconnect.
 * @dependencies @solana/wallet-adapter-react, @solana/web3.js, wallet-connection-provider, adapter UI styles
 * @index_tags solana,wallet,provider,client-only
 * @author holic512
 */
import { useCallback, useMemo, type ReactNode } from 'react'

import { WalletAdapterNetwork, type Adapter, type WalletError } from '@solana/wallet-adapter-base'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletConnectionProvider } from '@/components/wallet/wallet-connection-provider'
import '@solana/wallet-adapter-react-ui/styles.css'
import { clusterApiUrl } from '@solana/web3.js'

export function WalletRuntime({ children }: { children: ReactNode }) {
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl(WalletAdapterNetwork.Devnet),
    [],
  )
  const wallets = useMemo<Adapter[]>(() => [], [])
  const onError = useCallback((error: WalletError, adapter?: Adapter) => {
    console.warn(`[wallet] ${error.name}`, adapter?.name)
  }, [])

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider
        wallets={wallets}
        autoConnect
        localStorageKey="slothvault-solana-wallet"
        onError={onError}
      >
        <WalletConnectionProvider>{children}</WalletConnectionProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
