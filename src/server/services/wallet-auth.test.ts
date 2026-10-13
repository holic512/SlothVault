import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import nacl from 'tweetnacl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppPrismaClient } from '@/server/database/client'
import { personalSecurityDatabase } from '@/test/personal-security-database'
const fixture = vi.hoisted(() => ({ client: null as unknown as AppPrismaClient }))
vi.mock('@/server/database/client', () => ({ getDatabaseClient: () => fixture.client, configuredDatabaseProvider: () => 'sqlite' }))
vi.mock('@/server/prisma', () => ({ get prisma() { return fixture.client } }))
import { createWalletLoginChallenge, verifyWalletLogin } from './wallet-auth'
let database: ReturnType<typeof personalSecurityDatabase>
beforeEach(() => { database = personalSecurityDatabase(); fixture.client = database.client })
afterEach(async () => { vi.useRealTimers(); await database.close() })
async function loginProof(wallet: Keypair) {
  const address = wallet.publicKey.toBase58(), challenge = await createWalletLoginChallenge({ purpose: 'login', address })
  return { challengeId: challenge.challengeId, address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), wallet.secretKey)), ip: null, userAgent: null }
}
describe('explicit multi-wallet login', () => {
  it('provisions one regular account and authoritative binding, then reuses it', async () => {
    const wallet = Keypair.generate(), first = await verifyWalletLogin(await loginProof(wallet)), second = await verifyWalletLogin(await loginProof(wallet))
    expect(first.user).toMatchObject({ passwordConfigured: false, role: 'USER', walletAddress: wallet.publicKey.toBase58() })
    expect(first.user.id).toBe(second.user.id)
    expect(await fixture.client.userWallet.count()).toBe(1)
  })
  it('logs in through any bound address without using the representative column for lookup', async () => {
    const first = Keypair.generate(), second = Keypair.generate()
    const account = await verifyWalletLogin(await loginProof(first))
    await fixture.client.userWallet.create({ data: { userId: Number(account.user.id), address: second.publicKey.toBase58() } })
    expect((await verifyWalletLogin(await loginProof(second))).user.id).toBe(account.user.id)
    expect(await fixture.client.user.count()).toBe(1)
  })
  it('consumes a challenge only once', async () => {
    const proof = await loginProof(Keypair.generate())
    await verifyWalletLogin(proof)
    await expect(verifyWalletLogin(proof)).rejects.toMatchObject({ data: { reason: 'WALLET_CHALLENGE_EXPIRED' } })
  })
  it('rejects malformed-length and incorrect signatures without a server error', async () => {
    const proof = await loginProof(Keypair.generate())
    await expect(verifyWalletLogin({ ...proof, signature: bs58.encode(new Uint8Array(63)) })).rejects.toMatchObject({ status: 401 })
    const next = await loginProof(Keypair.generate())
    await expect(verifyWalletLogin({ ...next, signature: bs58.encode(new Uint8Array(64)) })).rejects.toMatchObject({ status: 401 })
  })
  it('rejects expiry and disabled accounts', async () => {
    const wallet = Keypair.generate(), proof = await loginProof(wallet)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300_001)
    await expect(verifyWalletLogin(proof)).rejects.toMatchObject({ data: { reason: 'WALLET_CHALLENGE_EXPIRED' } })
    vi.restoreAllMocks()
    const account = await verifyWalletLogin(await loginProof(wallet))
    await fixture.client.user.update({ where: { id: Number(account.user.id) }, data: { status: 0 } })
    await expect(verifyWalletLogin(await loginProof(wallet))).rejects.toMatchObject({ status: 403 })
  })
  it('does not accept an authenticated binding challenge as a login challenge', async () => {
    const account = await verifyWalletLogin(await loginProof(Keypair.generate())), wallet = Keypair.generate(), address = wallet.publicKey.toBase58()
    const challenge = await createWalletLoginChallenge({ purpose: 'bind', address, target: { action: 'bind', address }, context: { userId: Number(account.user.id), sessionId: account.session.sessionId } })
    await expect(verifyWalletLogin({ challengeId: challenge.challengeId, address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), wallet.secretKey)), ip: null, userAgent: null })).rejects.toMatchObject({ data: { reason: 'WALLET_PURPOSE_MISMATCH' } })
    expect(await fixture.client.user.count()).toBe(1)
  })
})
