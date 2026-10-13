/**
 * @file wallet-connection.ts
 * @project SlothVault
 * @module Wallet Connection Snapshots
 * @description Provides testable connection snapshots and account-stable message signing.
 * @logic Reject disconnected or changed accounts before and after signing exact server-provided bytes.
 * @dependencies wallet-adapter-base, bs58
 * @index_tags wallet,connection,signing,security
 * @author holic512
 */
import type { Adapter, MessageSignerWalletAdapter } from '@solana/wallet-adapter-base'
import bs58 from 'bs58'
export type ConnectedWallet = { adapter: Adapter; address: string; name: string }
export class WalletConnectionError extends Error { constructor(readonly reason: string) { super(reason); this.name = 'WalletConnectionError' } }
export function connectedWallet(adapter: Adapter): ConnectedWallet {
  if (!adapter.connected || !adapter.publicKey) throw new WalletConnectionError('WALLET_DISCONNECTED')
  return { adapter, address: adapter.publicKey.toBase58(), name: adapter.name }
}
export async function signWalletMessage(snapshot: ConnectedWallet, message: string, current: () => Adapter | null) {
  const assert = () => {
    if (current() !== snapshot.adapter || !snapshot.adapter.connected || snapshot.adapter.publicKey?.toBase58() !== snapshot.address) throw new WalletConnectionError('WALLET_CHANGED')
  }
  assert()
  if (!('signMessage' in snapshot.adapter) || typeof snapshot.adapter.signMessage !== 'function') throw new WalletConnectionError('WALLET_MESSAGE_UNSUPPORTED')
  const signature = await (snapshot.adapter as MessageSignerWalletAdapter).signMessage(new TextEncoder().encode(message))
  assert()
  return { address: snapshot.address, signature: bs58.encode(signature) }
}

/** One explicit request; ambient auto-connect events cannot start authentication. */
export class WalletConnectionRequests {
  private pending: { name: string | null; expectedAddress?: string; resolve: (wallet: ConnectedWallet) => void; reject: (error: Error) => void } | null = null

  get isPending() { return this.pending !== null }

  begin(expectedAddress?: string): Promise<ConnectedWallet> {
    if (this.pending) return Promise.reject(new WalletConnectionError('WALLET_BUSY'))
    return new Promise((resolve, reject) => { this.pending = { name: null, expectedAddress, resolve, reject } })
  }

  select(name: string) { if (this.pending) this.pending.name = name }

  connected(adapter: Adapter): boolean {
    const pending = this.pending
    if (!pending || pending.name !== adapter.name || !adapter.connected || !adapter.publicKey) return false
    const snapshot = connectedWallet(adapter)
    // Reauthentication may intentionally switch accounts within the same extension.
    // Keep the picker open until the user restores the locked target address.
    if (pending.expectedAddress && snapshot.address !== pending.expectedAddress) return false
    this.pending = null
    pending.resolve(snapshot)
    return true
  }

  fail(adapter: Adapter): boolean {
    if (this.pending?.name !== adapter.name) return false
    this.cancel('WALLET_CONNECTION_FAILED')
    return true
  }

  cancel(reason = 'WALLET_CANCELLED') {
    this.pending?.reject(new WalletConnectionError(reason))
    this.pending = null
  }
}
