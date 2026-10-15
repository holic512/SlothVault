import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import nacl from 'tweetnacl'
import type { AppPrismaClient } from '@/server/database/client'
import { personalSecurityDatabase } from '@/test/personal-security-database'

const fixture = vi.hoisted(() => ({ client: null as unknown as AppPrismaClient }))
vi.mock('@/server/prisma', () => ({ get prisma() { return fixture.client } }))
vi.mock('@/server/database/client', () => ({ getDatabaseClient: () => fixture.client, configuredDatabaseProvider: () => 'sqlite' }))
vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: async () => ({ status: 'INSTALLED' }), isDatabaseConnectivityError: () => false }))
import { POST as login } from '../login/route'
import { POST as register } from '../register/route'
import { GET as session } from '../session/route'
import { POST as renew } from '../session/renew/route'
import { POST as logout } from '../logout/route'
import { POST as walletVerify } from '../wallet/verify/route'
import { POST as legacyLogin } from '@/app/api/admin/auth/login/route'
import { POST as legacyLogout } from '@/app/api/admin/auth/logout/route'
import { GET as adminSession } from '@/app/api/admin/auth/session/route'
import { hashPassword } from '@/server/auth/password'
import { createWalletLoginChallenge } from '@/server/services/wallet-auth'
import { readSessionToken, SESSION_ABSOLUTE_TTL_MS, DEFAULT_SESSION_TTL_MS } from '@/server/auth/session'
const context = { params: Promise.resolve({}) }
let database: ReturnType<typeof personalSecurityDatabase>
let caseId = 0
const password = 'isolated-test-password'
const start = new Date('2026-10-15T00:00:00.000Z')
function request(path: string, body?: unknown, cookie = '', headers: Record<string, string> = {}) {
  return new NextRequest(`https://app.example.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: 'https://app.example.test', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${caseId}`, cookie, ...headers },
  })
}
function cookie(response: Response) { return response.headers.get('set-cookie')!.split(';')[0] }
function token(response: Response) { return cookie(response).slice('sv_session='.length) }
async function signIn(remember = false, identifier = 'user') {
  return login(request('/api/auth/login', { identifier, password, remember }), context)
}
beforeEach(async () => {
  caseId++
  database = personalSecurityDatabase(); fixture.client = database.client
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(start)
  const hash = await hashPassword(password)
  await fixture.client.user.create({ data: { username: 'user', email: 'user@example.test', password: hash } })
  await fixture.client.user.create({ data: { username: 'admin', password: hash, role: 'ADMIN' } })
})
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await database.close() })

describe('unified authentication routes with a real isolated database', () => {
  it.each(['user', 'admin', ' USER@EXAMPLE.TEST '])('logs in %s through the shared endpoint with a nonpersistent cookie by default', async identifier => {
    const response = await signIn(false, identifier)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('set-cookie')).not.toMatch(/Expires|Max-Age/)
    const persisted = await readSessionToken(token(response))
    expect(persisted?.persistent).toBe(false)
    expect(persisted?.expiresAt.getTime()).toBe(start.getTime() + DEFAULT_SESSION_TTL_MS)
    const dto = (await response.json()).data
    expect(dto.id).toBeTypeOf('string')
    expect(dto).not.toHaveProperty('password')
  })
  it('issues a seven-day persistent cookie and preserves the GET session DTO', async () => {
    const response = await signIn(true)
    expect(response.headers.get('set-cookie')).toContain('Expires=Thu, 22 Oct 2026')
    const result = await session(request('/api/auth/session', undefined, cookie(response)), context)
    expect((await result.json()).data).toMatchObject({ username: 'user', role: 'USER' })
    expect(result.headers.get('set-cookie')).toBeNull()
    expect(result.headers.get('cache-control')).toContain('no-store')
  })
  it('retains legacy administrator DTO and rejects regular identities without issuing sessions', async () => {
    const denied = await legacyLogin(request('/api/admin/auth/login', { username: 'user', password }), context)
    expect(denied.status).toBe(401)
    expect(await fixture.client.session.count()).toBe(0)
    const response = await legacyLogin(request('/api/admin/auth/login', { username: 'admin', password, remember: true }), context)
    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({ id: 2, username: 'admin', role: 'ADMIN' })
    expect((await readSessionToken(token(response)))?.expiresAt.getTime()).toBe(start.getTime() + SESSION_ABSOLUTE_TTL_MS)
  })
  it.each(['bad-password', 'disabled', 'wallet-only'])('rejects %s without creating a session', async mode => {
    if (mode === 'disabled') await fixture.client.user.update({ where: { username: 'user' }, data: { status: 0 } })
    if (mode === 'wallet-only') await fixture.client.user.update({ where: { username: 'user' }, data: { passwordConfigured: false } })
    const response = await login(request('/api/auth/login', { identifier: 'user', password: mode === 'bad-password' ? 'wrong' : password }), context)
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await fixture.client.session.count()).toBe(0)
  })
  it('shares the attempt limit across legacy and unified login paths', async () => {
    for (let i = 0; i < 12; i++) {
      const response = i % 2
        ? await legacyLogin(request('/api/admin/auth/login', { username: 'missing', password }), context)
        : await login(request('/api/auth/login', { identifier: 'missing', password }), context)
      expect(response.status).toBe(401)
    }
    expect((await signIn()).status).toBe(429)
  })
  it('uses nonpersistent bounded sessions after registration', async () => {
    const response = await register(request('/api/auth/register', { username: 'new-user'.replace('-', '_'), password }), context)
    expect(response.status).toBe(201)
    expect(response.headers.get('set-cookie')).not.toContain('Expires=')
    expect((await readSessionToken(token(response)))?.persistent).toBe(false)
  })
  it.each([false, true])('applies the same persistence choice to wallet login: %s', async remember => {
    const wallet = Keypair.generate(), address = wallet.publicKey.toBase58()
    const challenge = await createWalletLoginChallenge({ purpose: 'login', address })
    const response = await walletVerify(request('/api/auth/wallet/verify', {
      challengeId: challenge.challengeId, address, remember,
      signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), wallet.secretKey)),
    }), context)
    expect(response.status).toBe(200)
    const row = await readSessionToken(token(response))
    expect(row?.persistent).toBe(remember)
    expect(row?.expiresAt.getTime()).toBe(start.getTime() + (remember ? SESSION_ABSOLUTE_TTL_MS : DEFAULT_SESSION_TTL_MS))
  })
  it('returns lifecycle metadata, extends idle expiry, and preserves the absolute cap', async () => {
    const loginResponse = await signIn()
    vi.setSystemTime(new Date(start.getTime() + 6 * 60 * 60 * 1000))
    const response = await renew(request('/api/auth/session/renew', {}, cookie(loginResponse)), context)
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      user: { username: 'user' }, persistent: false,
      expiresAt: '2026-10-15T18:00:00.000Z', absoluteExpiresAt: '2026-10-22T00:00:00.000Z',
    })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('rejects cross-site renewal and client-supplied lifetime overrides', async () => {
    const signed = await signIn()
    expect((await renew(request('/api/auth/session/renew', {}, cookie(signed), { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), context)).status).toBe(403)
    expect((await renew(request('/api/auth/session/renew', {}, cookie(signed), { origin: '' }), context)).status).toBe(403)
    expect((await renew(request('/api/auth/session/renew', { ttlMs: 30 * 24 * 60 * 60 * 1000 }, cookie(signed)), context)).status).toBe(400)
  })
  it('rate-limits repeated renewal without revoking a valid session', async () => {
    const signed = await signIn()
    for (let i = 0; i < 60; i++) expect((await renew(request('/api/auth/session/renew', {}, cookie(signed)), context)).status).toBe(200)
    expect((await renew(request('/api/auth/session/renew', {}, cookie(signed)), context)).status).toBe(429)
    expect(await readSessionToken(token(signed))).not.toBeNull()
  })
  it('expires at the exact absolute boundary and clears the invalid browser cookie', async () => {
    const signed = await signIn(true)
    vi.setSystemTime(new Date(start.getTime() + SESSION_ABSOLUTE_TTL_MS))
    const response = await renew(request('/api/auth/session/renew', {}, cookie(signed)), context)
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970')
    expect((await (await session(request('/api/auth/session', undefined, cookie(signed)), context)).json()).data).toBeNull()
  })
  it.each([false, true])('revokes shared tokens through logout (legacy=%s) and blocks replay', async legacy => {
    const signed = await signIn(true, 'admin')
    const route = legacy ? legacyLogout : logout
    const response = await route(request(legacy ? '/api/admin/auth/logout' : '/api/auth/logout', {}, cookie(signed)), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect((await renew(request('/api/auth/session/renew', {}, cookie(signed)), context)).status).toBe(401)
  })
  it('keeps administrator APIs role guarded after shared login and after a role downgrade', async () => {
    const user = await signIn()
    expect((await adminSession(request('/api/admin/auth/session', undefined, cookie(user)), context)).status).toBe(401)
    const admin = await signIn(false, 'admin')
    expect((await adminSession(request('/api/admin/auth/session', undefined, cookie(admin)), context)).status).toBe(200)
    await fixture.client.user.update({ where: { username: 'admin' }, data: { role: 'USER' } })
    expect((await adminSession(request('/api/admin/auth/session', undefined, cookie(admin)), context)).status).toBe(401)
  })
})
