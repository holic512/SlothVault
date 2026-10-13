import { Keypair } from '@solana/web3.js'
import type { Adapter, MessageSignerWalletAdapter } from '@solana/wallet-adapter-base'
import { expect, it, vi } from 'vitest'
import { connectedWallet, signWalletMessage, WalletConnectionRequests } from './wallet-connection'
function adapter(name: string) { return { name, connected: true, publicKey: Keypair.generate().publicKey, signMessage: vi.fn(async () => new Uint8Array(64)) } as unknown as Adapter }
it.each(['Phantom', 'OKX Wallet'])('signs exact message bytes through the discovered %s adapter', async name => {
  const wallet = adapter(name), snapshot = connectedWallet(wallet)
  expect((await signWalletMessage(snapshot, 'exact\nmessage', () => wallet)).address).toBe(snapshot.address)
  expect((wallet as MessageSignerWalletAdapter).signMessage).toHaveBeenCalledWith(new TextEncoder().encode('exact\nmessage'))
})
it('rejects unsupported message signing', async () => { const wallet = adapter('Other'); Object.assign(wallet, { signMessage: undefined }); await expect(signWalletMessage(connectedWallet(wallet), 'message', () => wallet)).rejects.toMatchObject({ reason: 'WALLET_MESSAGE_UNSUPPORTED' }) })
it('rejects account changes while the signature dialog is open', async () => {
  const wallet = adapter('Phantom'), snapshot = connectedWallet(wallet)
  Object.assign(wallet, { signMessage: vi.fn(async () => { Object.assign(wallet, { publicKey: Keypair.generate().publicKey }); return new Uint8Array(64) }) })
  await expect(signWalletMessage(snapshot, 'message', () => wallet)).rejects.toMatchObject({ reason: 'WALLET_CHANGED' })
})
it('rejects adapter replacement or disconnect before signing', async () => { const wallet = adapter('Phantom'), snapshot = connectedWallet(wallet); await expect(signWalletMessage(snapshot, 'message', () => adapter('OKX Wallet'))).rejects.toMatchObject({ reason: 'WALLET_CHANGED' }); Object.assign(wallet, { connected: false }); expect(() => connectedWallet(wallet)).toThrow('WALLET_DISCONNECTED') })

it('waits for the chosen adapter and does not resolve from an ambient reconnect', async () => {
  const requests = new WalletConnectionRequests(), phantom = adapter('Phantom'), okx = adapter('OKX Wallet')
  expect(requests.connected(phantom)).toBe(false)
  const pending = requests.begin()
  expect(requests.connected(phantom)).toBe(false)
  requests.select('OKX Wallet')
  expect(requests.connected(phantom)).toBe(false)
  expect(requests.connected(okx)).toBe(true)
  expect((await pending).adapter).toBe(okx)
  expect(requests.isPending).toBe(false)
})
it('cancels pending connections and ignores late connection events', async () => {
  const requests = new WalletConnectionRequests(), wallet = adapter('Phantom'), result = requests.begin()
  requests.select(wallet.name)
  const assertion = expect(result).rejects.toMatchObject({ reason: 'WALLET_CANCELLED' })
  requests.cancel(); await assertion
  expect(requests.connected(wallet)).toBe(false)
})
it('rejects duplicate requests and connection errors without leaving the flow blocked', async () => {
  const requests = new WalletConnectionRequests(), wallet = adapter('Phantom'), pending = requests.begin()
  await expect(requests.begin()).rejects.toMatchObject({ reason: 'WALLET_BUSY' })
  requests.select(wallet.name)
  const assertion = expect(pending).rejects.toMatchObject({ reason: 'WALLET_CONNECTION_FAILED' })
  expect(requests.fail(adapter('OKX Wallet'))).toBe(false)
  expect(requests.fail(wallet)).toBe(true); await assertion
  expect(requests.isPending).toBe(false)
})
it('waits for the required account when reauthentication switched accounts in one extension', async () => {
  const requests = new WalletConnectionRequests(), wallet = adapter('Phantom'), expected = Keypair.generate().publicKey
  const pending = requests.begin(expected.toBase58()); requests.select(wallet.name)
  expect(requests.connected(wallet)).toBe(false)
  Object.assign(wallet, { publicKey: expected })
  expect(requests.connected(wallet)).toBe(true)
  expect((await pending).address).toBe(expected.toBase58())
})
