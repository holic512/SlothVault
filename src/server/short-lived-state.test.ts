import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  consumeEphemeralJson,
  enforceRateLimit,
  resetShortLivedStateForTests,
  shortLivedStateKey,
  storeEphemeralJson,
} from '@/server/short-lived-state'

describe('in-memory short-lived state', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-08T00:00:00.000Z'))
    resetShortLivedStateForTests()
  })

  afterEach(() => {
    resetShortLivedStateForTests()
    vi.useRealTimers()
  })

  it('stores one value per key and consumes it exactly once', async () => {
    const key = shortLivedStateKey('wallet-login', 'challenge-id')

    await expect(storeEphemeralJson(key, { nonce: 'first' }, 300)).resolves.toBe(true)
    await expect(storeEphemeralJson(key, { nonce: 'second' }, 300)).resolves.toBe(false)
    await expect(consumeEphemeralJson(key)).resolves.toEqual({ nonce: 'first' })
    await expect(consumeEphemeralJson(key)).resolves.toBeNull()
  })

  it('allows only one concurrent consumer to receive a challenge', async () => {
    const key = shortLivedStateKey('wallet-login', 'concurrent-challenge')
    await storeEphemeralJson(key, { nonce: 'single-use' }, 300)

    const results = await Promise.all([
      consumeEphemeralJson<{ nonce: string }>(key),
      consumeEphemeralJson<{ nonce: string }>(key),
    ])

    expect(results.filter((result) => result !== null)).toEqual([{ nonce: 'single-use' }])
    expect(results.filter((result) => result === null)).toHaveLength(1)
  })

  it('does not return an expired value', async () => {
    await storeEphemeralJson('expiring', { value: true }, 5)
    vi.advanceTimersByTime(5_000)

    await expect(consumeEphemeralJson('expiring')).resolves.toBeNull()
  })

  it('enforces a fixed request window and resets after expiry', async () => {
    const options = { scope: 'login', identity: '127.0.0.1', limit: 2, windowSeconds: 60 }

    await expect(enforceRateLimit(options)).resolves.toBeUndefined()
    await expect(enforceRateLimit(options)).resolves.toBeUndefined()
    await expect(enforceRateLimit(options)).rejects.toMatchObject({
      status: 429,
      data: { retryAfter: 60 },
    })

    vi.advanceTimersByTime(60_000)
    await expect(enforceRateLimit(options)).resolves.toBeUndefined()
  })

  it('isolates rate limits by scope and identity and rounds retry time up', async () => {
    const options = { scope: 'login', identity: 'client-a', limit: 1, windowSeconds: 60 }
    await enforceRateLimit(options)
    vi.advanceTimersByTime(10_001)

    await expect(enforceRateLimit(options)).rejects.toMatchObject({
      status: 429,
      data: { retryAfter: 50 },
    })
    await expect(
      enforceRateLimit({ ...options, identity: 'client-b' }),
    ).resolves.toBeUndefined()
    await expect(
      enforceRateLimit({ ...options, scope: 'admin-login' }),
    ).resolves.toBeUndefined()
  })
})
