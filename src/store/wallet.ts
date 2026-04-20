'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

type WalletState = {
  connected: boolean
  publicKey: string | null
  balance: number
  connecting: boolean
  loadingBalance: boolean
  manualDisconnect: boolean
  shortAddress: () => string
  solBalance: () => string
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  fetchBalance: () => Promise<void>
  handleAccountChanged: (publicKey: PublicKey | null | undefined) => void
  handleDisconnect: () => void
  checkConnection: () => Promise<void>
}

let wallet: any = null
let accountChangedHandler: ((pk: PublicKey | null) => void) | null = null
let disconnectHandler: (() => void) | null = null

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      connected: false,
      publicKey: null,
      balance: 0,
      connecting: false,
      loadingBalance: false,
      manualDisconnect: false,
      shortAddress: () => {
        const publicKey = get().publicKey
        return publicKey ? `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}` : ''
      },
      solBalance: () => (get().balance / LAMPORTS_PER_SOL).toFixed(4),
      connect: async () => {
        if (typeof window === 'undefined') {
          return
        }
        const solana = (window as any).solana
        if (!solana?.isPhantom) {
          throw new Error('请先安装 Phantom 钱包')
        }

        set({ connecting: true, manualDisconnect: false })
        try {
          const response = await solana.connect()
          wallet = solana
          set({ publicKey: response.publicKey.toString(), connected: true })
          await get().fetchBalance()

          accountChangedHandler = (pk) => get().handleAccountChanged(pk)
          disconnectHandler = () => get().handleDisconnect()
          solana.on('accountChanged', accountChangedHandler)
          solana.on('disconnect', disconnectHandler)
        } finally {
          set({ connecting: false })
        }
      },
      disconnect: async () => {
        set({ manualDisconnect: true })
        if (wallet) {
          if (accountChangedHandler) wallet.off?.('accountChanged', accountChangedHandler)
          if (disconnectHandler) wallet.off?.('disconnect', disconnectHandler)
          await wallet.disconnect().catch(() => undefined)
        }
        wallet = null
        accountChangedHandler = null
        disconnectHandler = null
        set({ connected: false, publicKey: null, balance: 0 })
      },
      fetchBalance: async () => {
        const address = get().publicKey
        if (!address) return

        set({ loadingBalance: true })
        try {
          const response = await fetch(`/api/solana/balance?address=${address}`)
          const result = await response.json()
          if (result.code === 0) {
            set({ balance: result.data.balance })
          }
        } finally {
          set({ loadingBalance: false })
        }
      },
      handleAccountChanged: (publicKey) => {
        if (publicKey) {
          set({ publicKey: publicKey.toString(), connected: true })
          void get().fetchBalance()
        } else {
          set({ connected: false, publicKey: null, balance: 0 })
        }
      },
      handleDisconnect: () => {
        wallet = null
        accountChangedHandler = null
        disconnectHandler = null
        set({ connected: false, publicKey: null, balance: 0 })
      },
      checkConnection: async () => {
        if (typeof window === 'undefined' || get().manualDisconnect) {
          return
        }

        const solana = (window as any).solana
        if (solana?.isPhantom && solana.isConnected && solana.publicKey) {
          wallet = solana
          set({ publicKey: solana.publicKey.toString(), connected: true })
          accountChangedHandler = (pk) => get().handleAccountChanged(pk)
          disconnectHandler = () => get().handleDisconnect()
          solana.on('accountChanged', accountChangedHandler)
          solana.on('disconnect', disconnectHandler)
          await get().fetchBalance()
        }
      }
    }),
    {
      name: 'wallet-storage',
      partialize: (state) => ({ manualDisconnect: state.manualDisconnect })
    }
  )
)
