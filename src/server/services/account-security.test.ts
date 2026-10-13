import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import nacl from 'tweetnacl'
import type { AppPrismaClient } from '@/server/database/client'
import { personalSecurityDatabase } from '@/test/personal-security-database'
import type { AccountAction, WalletChallengePurpose } from '@/types/account-security'
const fixture = vi.hoisted(() => ({ client: null as unknown as AppPrismaClient }))
vi.mock('@/server/database/client', () => ({ getDatabaseClient: () => fixture.client, configuredDatabaseProvider: () => 'sqlite' }))
vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: async () => ({ status: 'INSTALLED' }), isDatabaseConnectivityError: () => false }))
vi.mock('@/server/prisma', () => ({ get prisma() { return fixture.client } }))
import { NextRequest } from 'next/server'
import { POST as challengeRoute } from '@/app/api/auth/wallet/challenge/route'
import { POST as bindRoute, GET as walletsRoute } from '@/app/api/account/wallets/route'
import { POST as passwordRoute } from '@/app/api/account/password/route'
import { PATCH as credentialsRoute } from '@/app/api/account/credentials/route'
import { hashPassword } from '@/server/auth/password'
import { issueSession, readSessionToken } from '@/server/auth/session'
import { createWalletLoginChallenge } from './wallet-auth'
import { mutateAccountWallet, updateAccountCredentials, listAccountWallets } from './account-security'
import { loginUser } from './user-auth'
let database: ReturnType<typeof personalSecurityDatabase>
beforeEach(() => { database = personalSecurityDatabase(); fixture.client = database.client })
afterEach(async () => { vi.useRealTimers(); await database.close() })
const passwordProof = { method: 'password' as const, password: 'known-password' }
async function owner(configured = true) {
  const wallet = Keypair.generate(), address = wallet.publicKey.toBase58()
  const user = await fixture.client.user.create({ data: { username: `owner_${address.slice(0, 6).toLowerCase()}`, password: await hashPassword('known-password'), passwordConfigured: configured, walletAddress: address, wallets: { create: { address } } } })
  const session = await issueSession({ userId: user.id })
  return { user, wallet, session, context: { userId: user.id, sessionId: session.sessionId } }
}
async function proof(wallet: Keypair, purpose: WalletChallengePurpose, target: AccountAction, context: { userId: number; sessionId: string }) {
  const address = wallet.publicKey.toBase58(), challenge = await createWalletLoginChallenge({ purpose, address, target, context })
  return { challengeId: challenge.challengeId, address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), wallet.secretKey)) }
}
async function add(account: Awaited<ReturnType<typeof owner>>, wallet: Keypair) {
  const target = { action: 'bind' as const, address: wallet.publicKey.toBase58() }
  return mutateAccountWallet(account.context, { target, ownership: await proof(wallet, 'bind', target, account.context), reauth: { method: 'wallet', ...await proof(account.wallet, 'reauth', target, account.context) } })
}
describe('personal multi-wallet management', () => {
  it('adds a second wallet with existing-wallet reauthentication and keeps the first projection', async () => {
    const account = await owner(false), result = await add(account, Keypair.generate())
    expect(result.wallets).toHaveLength(2)
    expect(result.user.walletAddress).toBe(account.wallet.publicKey.toBase58())
    expect(await readSessionToken(account.session.token)).not.toBeNull()
  })
  it('returns an idempotent result for the same-account address', async () => {
    const account = await owner(), target = { action: 'bind' as const, address: account.wallet.publicKey.toBase58() }
    const result = await mutateAccountWallet(account.context, { target, ownership: await proof(account.wallet, 'bind', target, account.context), reauth: passwordProof })
    expect(result.wallets).toHaveLength(1)
    expect((await fixture.client.user.findUniqueOrThrow({ where: { id: account.user.id } })).credentialsRevision).toBe(0)
  })
  it('rejects cross-account binding and rolls back a conflicting replacement', async () => {
    const account = await owner(), another = await owner(), old = (await listAccountWallets(account.user.id))[0]
    const target = { action: 'replace' as const, walletId: old.id, address: another.wallet.publicKey.toBase58() }
    await expect(mutateAccountWallet(account.context, { target, ownership: await proof(another.wallet, 'replace', target, account.context), reauth: passwordProof })).rejects.toMatchObject({ data: { reason: 'WALLET_ALREADY_BOUND' } })
    expect((await listAccountWallets(account.user.id))[0].address).toBe(old.address)
    expect((await fixture.client.user.findUniqueOrThrow({ where: { id: account.user.id } })).credentialsRevision).toBe(0)
    const bind = { action: 'bind' as const, address: another.wallet.publicKey.toBase58() }
    await expect(mutateAccountWallet(account.context, { target: bind, ownership: await proof(another.wallet, 'bind', bind, account.context), reauth: passwordProof })).rejects.toMatchObject({ data: { reason: 'WALLET_ALREADY_BOUND' } })
  })
  it('atomically replaces one binding and preserves the other wallet', async () => {
    const account = await owner(), extra = Keypair.generate(), next = Keypair.generate()
    await add(account, extra)
    const old = (await listAccountWallets(account.user.id))[0], target = { action: 'replace' as const, walletId: old.id, address: next.publicKey.toBase58() }
    const result = await mutateAccountWallet(account.context, { target, ownership: await proof(next, 'replace', target, account.context), reauth: passwordProof })
    expect(result.wallets.map(wallet => wallet.address).sort()).toEqual([extra.publicKey.toBase58(), next.publicKey.toBase58()].sort())
    expect(await fixture.client.userWallet.findUnique({ where: { address: old.address } })).toBeNull()
  })
  it('blocks removal of the sole wallet without a configured password', async () => {
    const account = await owner(false), binding = (await listAccountWallets(account.user.id))[0]
    await expect(mutateAccountWallet(account.context, { target: { action: 'unbind', walletId: binding.id }, reauth: passwordProof })).rejects.toMatchObject({ data: { reason: 'LAST_LOGIN_METHOD' } })
    expect(await fixture.client.userWallet.count()).toBe(1)
  })
  it('allows removing one of multiple wallets without a password and revokes other sessions', async () => {
    const account = await owner(false), extra = Keypair.generate()
    await add(account, extra)
    const otherSession = await issueSession({ userId: account.user.id }), binding = (await listAccountWallets(account.user.id))[1]
    const target = { action: 'unbind' as const, walletId: binding.id }
    const result = await mutateAccountWallet(account.context, { target, reauth: { method: 'wallet', ...await proof(account.wallet, 'reauth', target, account.context) } })
    expect(result.wallets).toHaveLength(1)
    expect(await readSessionToken(otherSession.token)).toBeNull()
    expect(await readSessionToken(account.session.token)).not.toBeNull()
  })
  it('requires the actual current password when removing the last wallet', async () => {
    const account = await owner(), binding = (await listAccountWallets(account.user.id))[0], target = { action: 'unbind' as const, walletId: binding.id }
    await expect(mutateAccountWallet(account.context, { target, reauth: { method: 'wallet', ...await proof(account.wallet, 'reauth', target, account.context) } })).rejects.toMatchObject({ data: { reason: 'LAST_WALLET_PASSWORD_REQUIRED' } })
    await expect(mutateAccountWallet(account.context, { target, reauth: { method: 'password', password: 'wrong' } })).rejects.toMatchObject({ data: { reason: 'PASSWORD_INCORRECT' } })
    const result = await mutateAccountWallet(account.context, { target, reauth: passwordProof })
    expect(result.wallets).toEqual([]); expect(result.user.walletAddress).toBeNull()
    expect((await loginUser({ identifier: account.user.username, password: 'known-password', remember: false, ip: null, userAgent: null })).user.id).toBe(String(account.user.id))
  })
  it('rejects operation target, session and credential revision changes', async () => {
    const account = await owner(), next = Keypair.generate(), target = { action: 'bind' as const, address: next.publicKey.toBase58() }
    const ownership = await proof(next, 'bind', target, account.context)
    const reauth = { method: 'wallet' as const, ...await proof(account.wallet, 'reauth', { action: 'credentials', passwordChange: false, username: 'wrong_target' }, account.context) }
    await expect(mutateAccountWallet(account.context, { target, ownership, reauth })).rejects.toMatchObject({ data: { reason: 'WALLET_PURPOSE_MISMATCH' } })
    const changed = await proof(next, 'bind', target, account.context)
    await fixture.client.user.update({ where: { id: account.user.id }, data: { credentialsRevision: { increment: 1 } } })
    await expect(mutateAccountWallet(account.context, { target, ownership: changed, reauth: passwordProof })).rejects.toMatchObject({ data: { reason: 'SESSION_CHANGED' } })
    const anotherSession = await issueSession({ userId: account.user.id }), sessionProof = await proof(next, 'bind', target, account.context)
    await expect(mutateAccountWallet({ ...account.context, sessionId: anotherSession.sessionId }, { target, ownership: sessionProof, reauth: passwordProof })).rejects.toMatchObject({ data: { reason: 'SESSION_CHANGED' } })
  })
  it('does not delete all wallets through concurrent removals', async () => {
    const account = await owner(false); await add(account, Keypair.generate())
    const bindings = await listAccountWallets(account.user.id)
    const operations = await Promise.all(bindings.map(async binding => { const target = { action: 'unbind' as const, walletId: binding.id }; return { target, reauth: { method: 'wallet' as const, ...await proof(account.wallet, 'reauth', target, account.context) } } }))
    const result = await Promise.allSettled(operations.map(input => mutateAccountWallet(account.context, input)))
    expect(result.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(await fixture.client.userWallet.count()).toBe(1)
  })
})
describe('personal username and password credentials', () => {
  it('configures a wallet account username and password atomically and signs out all sessions', async () => {
    const account = await owner(false), target = { action: 'credentials' as const, username: 'my_account', passwordChange: true }
    const result = await updateAccountCredentials(account.context, { username: 'my_account', newPassword: 'new-known-password', reauth: { method: 'wallet', ...await proof(account.wallet, 'reauth', target, account.context) } })
    expect(result.credentials.usernameChangeQuota.used).toBe(1)
    expect(result.user.passwordConfigured).toBe(true)
    expect(await readSessionToken(account.session.token)).toBeNull()
    expect((await loginUser({ identifier: 'my_account', password: 'new-known-password', remember: false, ip: null, userAgent: null })).user.id).toBe(String(account.user.id))
  })
  it('counts three successful renames and rejects the fourth while no-op requests are free', async () => {
    const account = await owner()
    for (let index = 1; index <= 3; index++) expect((await updateAccountCredentials(account.context, { username: `name_${index}`, reauth: passwordProof })).credentials.usernameChangeQuota.used).toBe(index)
    await expect(updateAccountCredentials(account.context, { username: 'name_4', reauth: passwordProof })).rejects.toMatchObject({ data: { reason: 'USERNAME_CHANGE_LIMIT_REACHED' } })
    expect((await updateAccountCredentials(account.context, { username: 'NAME_3', reauth: passwordProof })).credentials.usernameChangeQuota.used).toBe(3)
    expect((await updateAccountCredentials(account.context, { newPassword: 'updated-password', reauth: passwordProof })).passwordChanged).toBe(true)
  })
  it('does not count or partially apply failed renames', async () => {
    const account = await owner(), taken = await owner()
    await expect(updateAccountCredentials(account.context, { username: taken.user.username, newPassword: 'must-not-apply', reauth: passwordProof })).rejects.toMatchObject({ data: { reason: 'USERNAME_TAKEN' } })
    const user = await fixture.client.user.findUniqueOrThrow({ where: { id: account.user.id } })
    expect(user.usernameChangeCount).toBe(0); expect(user.credentialsRevision).toBe(0)
    expect(await readSessionToken(account.session.token)).not.toBeNull()
  })
  it('enforces the quota under concurrent password-authenticated renames', async () => {
    const account = await owner()
    const result = await Promise.allSettled([1, 2, 3, 4].map(index => updateAccountCredentials(account.context, { username: `parallel_${index}`, reauth: passwordProof })))
    expect(result.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(3)
    expect((await fixture.client.user.findUniqueOrThrow({ where: { id: account.user.id } })).usernameChangeCount).toBe(3)
  })
})

describe('personal credential HTTP boundaries', () => {
  const request = (path: string, body: unknown, token?: string) => new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { cookie: `sv_session=${token}` } : {}) }, body: JSON.stringify(body) })
  it('requires explicit challenge purposes and an active session for binding', async () => {
    const wallet = Keypair.generate(), address = wallet.publicKey.toBase58()
    expect((await challengeRoute(request('/api/auth/wallet/challenge', { address }), { params: Promise.resolve({}) })).status).toBe(400)
    expect((await challengeRoute(request('/api/auth/wallet/challenge', { purpose: 'bind', address, target: { action: 'bind', address } }), { params: Promise.resolve({}) })).status).toBe(401)
    expect(await fixture.client.user.count()).toBe(0)
  })
  it('rejects unauthenticated mutations and validates usernames before credential changes', async () => {
    expect((await bindRoute(request('/api/account/wallets', {}), { params: Promise.resolve({}) })).status).toBe(401)
    const account = await owner()
    const response = await credentialsRoute(new NextRequest('http://localhost/api/account/credentials', { method: 'PATCH', headers: { cookie: `sv_session=${account.session.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'bad@name', reauth: passwordProof }) }), { params: Promise.resolve({}) })
    expect(response.status).toBe(400)
    expect((await fixture.client.user.findUniqueOrThrow({ where: { id: account.user.id } })).usernameChangeCount).toBe(0)
  })
  it('does not let the legacy password endpoint bypass wallet reauthentication for initial setup', async () => {
    const account = await owner(false)
    const response = await passwordRoute(request('/api/account/password', { newPassword: 'setup-password' }, account.session.token), { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect((await fixture.client.user.findUniqueOrThrow({ where: { id: account.user.id } })).passwordConfigured).toBe(false)
    expect(await readSessionToken(account.session.token)).not.toBeNull()
  })
  it('returns only the authenticated account wallet list', async () => {
    const account = await owner(); await owner()
    const response = await walletsRoute(new NextRequest('http://localhost/api/account/wallets', { headers: { cookie: `sv_session=${account.session.token}` } }), { params: Promise.resolve({}) })
    const payload = await response.json()
    expect(payload.data).toHaveLength(1)
    expect(payload.data[0]).toMatchObject({ address: account.wallet.publicKey.toBase58() })
    expect(JSON.stringify(payload)).not.toMatch(/password|tokenHash|credentialsRevision/)
  })
})
