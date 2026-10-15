import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import type { AppPrismaClient } from '@/server/database/client'
import { personalSecurityDatabase } from '@/test/personal-security-database'

const fixture = vi.hoisted(() => ({ client: null as unknown as AppPrismaClient }))
vi.mock('@/server/prisma', () => ({ get prisma() { return fixture.client } }))
import { DEFAULT_SESSION_TTL_MS, SESSION_ABSOLUTE_TTL_MS, issueSession, readSessionToken, renewSessionToken, revokeSessionToken, revokeAllUserSessions, setSessionCookie, clearSessionCookie, sessionAbsoluteExpiresAt } from './session'
import { activeCredentialUser } from '@/server/services/wallet-auth'

let database: ReturnType<typeof personalSecurityDatabase>
const start = new Date('2026-10-15T00:00:00Z')
const hour = 60 * 60 * 1000
let userId: number
beforeEach(async () => {
  database = personalSecurityDatabase()
  fixture.client = database.client
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(start)
  userId = (await fixture.client.user.create({ data: { username: 'session-owner', password: 'test-only' } })).id
})
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); await database.close() })
const at = (ms: number) => vi.setSystemTime(new Date(start.getTime() + ms))

describe('bounded database sessions', () => {
  it.each([false, true])('issues explicit immutable authentication time and persistence=%s', async persistent => {
    const issued = await issueSession({ userId, persistent })
    const row = await fixture.client.session.findUniqueOrThrow({ where: { id: issued.sessionId } })
    expect(row.createdAt).toEqual(start)
    expect(row.persistent).toBe(persistent)
    expect(row.expiresAt.getTime() - start.getTime()).toBe(persistent ? SESSION_ABSOLUTE_TTL_MS : DEFAULT_SESSION_TTL_MS)
    expect(row.tokenHash).not.toBe(issued.token)
    expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/)
  })
  it('uses exact twelve-hour expiry for nonpersistent sessions and never revives expired tokens', async () => {
    const session = await issueSession({ userId })
    at(DEFAULT_SESSION_TTL_MS - 1)
    expect(await readSessionToken(session.token)).not.toBeNull()
    at(DEFAULT_SESSION_TTL_MS)
    expect(await readSessionToken(session.token)).toBeNull()
    expect(await renewSessionToken(session.token)).toBeNull()
  })
  it('extends active sessions from renewal time without changing createdAt or token', async () => {
    const session = await issueSession({ userId })
    at(6 * hour)
    const renewed = await renewSessionToken(session.token)
    expect(renewed?.expiresAt.getTime()).toBe(start.getTime() + 18 * hour)
    expect(renewed?.createdAt).toEqual(start)
    expect(renewed?.id).toBe(session.sessionId)
    expect(sessionAbsoluteExpiresAt(renewed!)).toEqual(new Date(start.getTime() + SESSION_ABSOLUTE_TTL_MS))
  })
  it('bounds a continuously active session at exactly seven days', async () => {
    const session = await issueSession({ userId })
    for (let elapsed = 6 * hour; elapsed < SESSION_ABSOLUTE_TTL_MS; elapsed += 6 * hour) {
      at(elapsed)
      const renewed = await renewSessionToken(session.token)
      expect(renewed).not.toBeNull()
      expect(renewed!.expiresAt.getTime()).toBeLessThanOrEqual(start.getTime() + SESSION_ABSOLUTE_TTL_MS)
      expect(renewed!.createdAt).toEqual(start)
    }
    at(SESSION_ABSOLUTE_TTL_MS - 1)
    expect((await renewSessionToken(session.token))?.expiresAt.getTime()).toBe(start.getTime() + SESSION_ABSOLUTE_TTL_MS)
    at(SESSION_ABSOLUTE_TTL_MS)
    expect(await renewSessionToken(session.token)).toBeNull()
  })
  it('keeps persistent sessions alive during absence, but never extends their fixed deadline', async () => {
    const session = await issueSession({ userId, persistent: true })
    at(6 * 24 * hour)
    expect((await renewSessionToken(session.token))?.expiresAt).toEqual(session.expiresAt)
    at(SESSION_ABSOLUTE_TTL_MS)
    expect(await renewSessionToken(session.token)).toBeNull()
  })
  it('independently rejects an overlong database expiry in read and credential-proof paths', async () => {
    const session = await issueSession({ userId, persistent: true })
    await fixture.client.session.update({ where: { id: session.sessionId }, data: { expiresAt: new Date(start.getTime() + 30 * 24 * hour) } })
    at(SESSION_ABSOLUTE_TTL_MS)
    expect(await readSessionToken(session.token)).toBeNull()
    await expect(activeCredentialUser(fixture.client, { userId, sessionId: session.sessionId })).rejects.toMatchObject({ status: 401 })
  })
  it('does not recreate logged-out sessions or accept unknown tokens', async () => {
    const session = await issueSession({ userId })
    await revokeSessionToken(session.token)
    expect(await renewSessionToken(session.token)).toBeNull()
    expect(await readSessionToken('not-a-token')).toBeNull()
    expect(await readSessionToken(undefined)).toBeNull()
    expect(await fixture.client.session.count()).toBe(1)
  })
  it('rechecks account status and current role on each read or renewal', async () => {
    await fixture.client.user.update({ where: { id: userId }, data: { role: 'ADMIN' } })
    const session = await issueSession({ userId })
    await fixture.client.user.update({ where: { id: userId }, data: { role: 'USER' } })
    expect((await renewSessionToken(session.token))?.User.role).toBe('USER')
    await fixture.client.user.update({ where: { id: userId }, data: { status: 0 } })
    expect(await renewSessionToken(session.token)).toBeNull()
  })
  it('revokes all user sessions without affecting other accounts', async () => {
    const first = await issueSession({ userId }), second = await issueSession({ userId, persistent: true })
    const otherId = (await fixture.client.user.create({ data: { username: 'other', password: 'test' } })).id
    const other = await issueSession({ userId: otherId })
    await revokeAllUserSessions(userId)
    expect(await renewSessionToken(first.token)).toBeNull()
    expect(await renewSessionToken(second.token)).toBeNull()
    expect(await readSessionToken(other.token)).not.toBeNull()
  })
  it('serializes concurrent renewal outcomes without shortening expiry', async () => {
    const session = await issueSession({ userId })
    at(6 * hour)
    const results = await Promise.all(Array.from({ length: 8 }, () => renewSessionToken(session.token)))
    expect(results.every(result => result?.expiresAt.getTime() === start.getTime() + 18 * hour)).toBe(true)
    expect(await fixture.client.session.count()).toBe(1)
  })
  it('cannot revive a session revoked between the first read and conditional update', async () => {
    const session = await issueSession({ userId })
    at(6 * hour)
    const update = fixture.client.session.updateMany.bind(fixture.client.session)
    vi.spyOn(fixture.client.session, 'updateMany').mockImplementationOnce((args => (async () => {
      await update({ where: { id: session.sessionId }, data: { revokedAt: new Date() } })
      return update(args)
    })()) as typeof fixture.client.session.updateMany)
    expect(await renewSessionToken(session.token)).toBeNull()
    expect((await fixture.client.session.findUniqueOrThrow({ where: { id: session.sessionId } })).expiresAt).toEqual(session.expiresAt)
  })
  it('cannot extend a session disabled between the read and conditional update', async () => {
    const session = await issueSession({ userId })
    at(6 * hour)
    const update = fixture.client.session.updateMany.bind(fixture.client.session)
    vi.spyOn(fixture.client.session, 'updateMany').mockImplementationOnce((args => (async () => {
      await fixture.client.user.update({ where: { id: userId }, data: { status: 0 } })
      return update(args)
    })()) as typeof fixture.client.session.updateMany)
    expect(await renewSessionToken(session.token)).toBeNull()
  })
  it('sets secure production cookies, distinguishing browser-session from persistent cookies', () => {
    vi.stubEnv('NODE_ENV', 'production')
    for (const persistent of [false, true]) {
      const response = NextResponse.json({})
      setSessionCookie(response, 'token', new Date(start.getTime() + SESSION_ABSOLUTE_TTL_MS), persistent)
      const cookie = response.headers.get('set-cookie')!
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('Secure')
      expect(cookie).toContain('SameSite=lax')
      expect(cookie.includes('Expires=')).toBe(persistent)
      expect(cookie).not.toContain('Max-Age=')
      clearSessionCookie(response)
      expect(response.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970')
    }
  })
})
