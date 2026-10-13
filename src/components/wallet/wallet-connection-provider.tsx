'use client'
/**
 * @file wallet-connection-provider.tsx
 * @project SlothVault
 * @module Wallet Connection Boundary
 * @description Hosts the shared picker and awaits provider-confirmed wallet connections.
 * @logic Resolve only the requested selected adapter, let WalletProvider auto-connect after selection, and reject pending requests on cancellation, connection failure or unmount.
 * @dependencies React, wallet-adapter-react, wallet-picker, wallet-connection
 * @index_tags wallet,provider,connection,promise,cancellation
 * @author holic512
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import type { Adapter, WalletName } from '@solana/wallet-adapter-base'
import { WalletPicker } from './wallet-picker'
import { connectedWallet, WalletConnectionRequests, WalletConnectionError, type ConnectedWallet } from './wallet-connection'
type Options = { forceSelect?: boolean; expectedAddress?: string; preferredWalletName?: string }
type Boundary = { pickerOpen: boolean; openWalletSelector: () => void; requestConnection: (options?: Options) => Promise<ConnectedWallet>; currentAdapter: () => Adapter | null }
const Context = createContext<Boundary | null>(null)
export function WalletConnectionProvider({ children }: { children: ReactNode }) {
  const state = useWallet(), stateRef = useRef(state), active = useRef(true)
  const [requests] = useState(() => new WalletConnectionRequests())
  const [open, setOpen] = useState(false), [error, setError] = useState<string | null>(null), [expectedAddress, setExpectedAddress] = useState<string>()
  useEffect(() => { stateRef.current = state })
  const close = useCallback(() => {
    requests.cancel(); setOpen(false)
  }, [requests])
  useEffect(() => { active.current = true; return () => { active.current = false; requests.cancel() } }, [requests])
  useEffect(() => {
    if (state.wallet) requests.connected(state.wallet.adapter)
  }, [state.connected, state.publicKey, state.wallet, requests])
  useEffect(() => {
    const failed = (adapter: Adapter) => () => {
      if (requests.fail(adapter)) setOpen(false)
      else setError('WALLET_CONNECTION_FAILED')
    }
    const subscriptions = state.wallets.map(({ adapter }) => { const callback = failed(adapter); adapter.on('error', callback); return () => adapter.off('error', callback) })
    return () => subscriptions.forEach(unsubscribe => unsubscribe())
  }, [state.wallets, requests])
  const select = useCallback((name: WalletName) => {
    const current = stateRef.current
    requests.select(name)
    if (current.wallet?.adapter.name === name) {
      if (current.wallet.adapter.connected) {
        if (requests.connected(current.wallet.adapter) || !requests.isPending) setOpen(false)
      } else if (!current.connecting && !current.wallet.adapter.connecting) {
        void current.connect().catch(() => { if (requests.fail(current.wallet!.adapter)) setOpen(false) })
      }
    } else current.select(name)
    if (!requests.isPending) setOpen(false)
  }, [requests])
  const requestConnection = useCallback(async (options: Options = {}) => {
    const current = stateRef.current
    if (!active.current) return Promise.reject(new WalletConnectionError('WALLET_CANCELLED'))
    if (requests.isPending) return Promise.reject(new WalletConnectionError('WALLET_BUSY'))
    if (!options.forceSelect && current.connected && current.wallet && (!options.expectedAddress || current.publicKey?.toBase58() === options.expectedAddress)) return Promise.resolve(connectedWallet(current.wallet.adapter))
    const result = requests.begin(options.expectedAddress).then(snapshot => { if (!active.current) throw new WalletConnectionError('WALLET_CANCELLED'); setOpen(false); return snapshot })
    setError(null); setExpectedAddress(options.expectedAddress); setOpen(true)
    const name = options.preferredWalletName ?? (!options.forceSelect ? current.wallet?.adapter.name : undefined)
    if (name && current.wallets.some(wallet => wallet.adapter.name === name)) select(name as WalletName)
    return result
  }, [select, requests])
  const openWalletSelector = useCallback(() => { setError(null); setExpectedAddress(undefined); setOpen(true) }, [])
  const currentAdapter = useCallback(() => active.current ? stateRef.current.wallet?.adapter ?? null : null, [])
  return <Context.Provider value={{ pickerOpen: open, openWalletSelector, requestConnection, currentAdapter }}>{children}{open ? <WalletPicker onSelect={select} onClose={close} error={error} expectedAddress={expectedAddress} /> : null}</Context.Provider>
}
export function useWalletConnection() { const value = useContext(Context); if (!value) throw new Error('WalletConnectionProvider is required'); return value }
