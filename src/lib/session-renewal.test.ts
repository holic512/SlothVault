import { describe, expect, it, vi } from 'vitest'
import { ApiClientError } from './api-client'
import { createSessionRenewalController, SESSION_RENEW_INTERVAL_MS } from './session-renewal'
import type { SessionRenewal } from '@/types/user'
const result = { user: { id: '1', role: 'USER' }, expiresAt: '2026-10-15T12:00:00Z', absoluteExpiresAt: '2026-10-22T00:00:00Z', persistent: false } as SessionRenewal
function fixture() {
  let time = 1_000
  const renew = vi.fn<(signal: AbortSignal) => Promise<SessionRenewal>>().mockResolvedValue(result)
  const apply = vi.fn(), expired = vi.fn()
  return { renew, apply, expired, tick: (ms: number) => { time += ms }, controller: createSessionRenewalController({ renew, apply, expired, now: () => time }) }
}
describe('activity-driven client renewal', () => {
  it('requires a visible authenticated page and throttles to five minutes', async () => {
    const f = fixture()
    await f.controller.activity(false, true); await f.controller.activity(true, false)
    expect(f.renew).not.toHaveBeenCalled()
    await f.controller.activity(true, true); await f.controller.activity(true, true)
    f.tick(SESSION_RENEW_INTERVAL_MS - 1); await f.controller.activity(true, true)
    expect(f.renew).toHaveBeenCalledTimes(1)
    f.tick(1); await f.controller.activity(true, true)
    expect(f.renew).toHaveBeenCalledTimes(2)
  })
  it('does not schedule keepalives simply because time passes', async () => {
    const f = fixture()
    await f.controller.activity(true, true)
    f.tick(7 * 24 * 60 * 60 * 1000)
    expect(f.renew).toHaveBeenCalledTimes(1)
  })
  it('keeps the identity on transient network errors and retries only on later activity', async () => {
    const f = fixture(); f.renew.mockRejectedValueOnce(new Error('offline'))
    await f.controller.activity(true, true)
    expect(f.expired).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled()
    f.tick(29_999); await f.controller.activity(true, true)
    expect(f.renew).toHaveBeenCalledTimes(1)
    f.tick(1); await f.controller.activity(true, true)
    expect(f.apply).toHaveBeenCalledWith(result)
  })
  it('expires only on an authoritative 401, not rate limits or server errors', async () => {
    const f = fixture()
    for (const status of [429, 500, 503]) {
      f.renew.mockRejectedValueOnce(new ApiClientError('unavailable', status, status, null))
      await f.controller.activity(true, true); f.tick(30_000)
    }
    expect(f.expired).not.toHaveBeenCalled()
    f.renew.mockRejectedValueOnce(new ApiClientError('Unauthorized', 401, 401, null))
    await f.controller.activity(true, true)
    expect(f.expired).toHaveBeenCalledOnce()
  })
  it('prevents overlapping requests and ignores a late response after logout or a cross-tab switch', async () => {
    const f = fixture()
    let finish!: (value: SessionRenewal) => void
    f.renew.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = f.controller.activity(true, true)
    await f.controller.activity(true, true)
    expect(f.renew).toHaveBeenCalledOnce()
    const signal = f.renew.mock.calls[0][0]
    f.controller.reset()
    expect(signal.aborted).toBe(true)
    finish(result); await pending
    expect(f.apply).not.toHaveBeenCalled()
    await f.controller.activity(true, true)
    expect(f.apply).toHaveBeenCalledOnce()
  })
})
