import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginRelease } from '@slothvault/plugin-sdk/protocol'

const mocks = vi.hoisted(() => ({ releases: vi.fn() }))
vi.mock('./sources', async importOriginal => ({
  ...await importOriginal<typeof import('./sources')>(),
  listPluginReleases: mocks.releases,
}))

const release = (id = 'test.example', version = '1.10.0', repository = 'test/plugins'): PluginRelease => ({
  repository, tag: 'v2.8.0', asset: `slothvault-plugin-${id}-${version}.zip`, version, notes: 'Release notes', size: 120,
})
const item = (source: string | null = 'test/plugins', version = '1.9.0', pluginId = 'test.example') => ({ pluginId, version, source })
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => { vi.resetModules(); mocks.releases.mockReset() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('plugin update discovery', () => {
  it('compares semantic versions, including double-digit components, and never offers a downgrade', async () => {
    const { checkPluginUpdate } = await import('./updates')
    mocks.releases.mockResolvedValue([release()])
    expect(await checkPluginUpdate(item())).toMatchObject({ status: 'available', currentVersion: '1.9.0', release: { version: '1.10.0' } })
    expect(await checkPluginUpdate(item('test/plugins', '1.10.0'))).toMatchObject({ status: 'current' })
    expect(await checkPluginUpdate(item('test/plugins', '2.0.0'))).toMatchObject({ status: 'current' })
  })

  it('requires the exact plugin ID and version asset name, not a prefix-similar ID', async () => {
    const { checkPluginUpdate } = await import('./updates')
    mocks.releases.mockResolvedValue([release('test.example-extra', '9.0.0'), release('test.other', '8.0.0'), { ...release(), asset: 'slothvault-plugin-test.example-7.0.0.zip' }, release('test.example', '1.9.1')])
    expect(await checkPluginUpdate(item())).toMatchObject({ status: 'available', release: { version: '1.9.1' } })
  })

  it('keeps an uploaded official-ID plugin manual when its installation has no known source', async () => {
    const { checkPluginUpdate } = await import('./updates')
    expect(await checkPluginUpdate(item(null, '1.0.0', 'slothvault.gift-cards'))).toMatchObject({ status: 'manual', release: null })
    expect(mocks.releases).not.toHaveBeenCalled()
  })

  it('reports no matching release without claiming that the installed version is current', async () => {
    const { checkPluginUpdate } = await import('./updates')
    mocks.releases.mockResolvedValue([release('test.other')])
    expect(await checkPluginUpdate(item())).toMatchObject({ status: 'noRelease', release: null })
  })

  it('binds official tag filtering to the recorded repository instead of only the plugin ID', async () => {
    const { checkPluginUpdate } = await import('./updates')
    const { OFFICIAL_PLUGINS } = await import('./sources')
    const official = OFFICIAL_PLUGINS[0]
    mocks.releases.mockResolvedValue([])
    await checkPluginUpdate(item(official.repository, '1.0.0', official.id))
    await checkPluginUpdate(item('other/repository', '1.0.0', official.id))
    expect(mocks.releases).toHaveBeenNthCalledWith(1, official.repository, official.tagPrefix)
    expect(mocks.releases).toHaveBeenNthCalledWith(2, 'other/repository', '')
  })

  it('shares in-flight and completed repository scans across plugin IDs, then refreshes after the TTL', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T00:00:00Z'))
    const { checkPluginUpdate } = await import('./updates')
    const scan = deferred<PluginRelease[]>()
    mocks.releases.mockReturnValueOnce(scan.promise).mockResolvedValue([])
    const a = checkPluginUpdate(item())
    const b = checkPluginUpdate(item('https://github.com/test/plugins', '1.0.0', 'test.other'))
    expect(mocks.releases).toHaveBeenCalledTimes(1)
    scan.resolve([release(), release('test.other', '2.0.0')])
    await expect(a).resolves.toMatchObject({ status: 'available' })
    await expect(b).resolves.toMatchObject({ status: 'available', release: { version: '2.0.0' } })
    await checkPluginUpdate(item())
    expect(mocks.releases).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_001)
    await checkPluginUpdate(item())
    expect(mocks.releases).toHaveBeenCalledTimes(2)
  })

  it('does not expire a queued or in-flight scan before it has completed', async () => {
    vi.useFakeTimers()
    const { checkPluginUpdate } = await import('./updates')
    const scan = deferred<PluginRelease[]>()
    mocks.releases.mockReturnValue(scan.promise)
    const a = checkPluginUpdate(item())
    vi.advanceTimersByTime(60_001)
    const b = checkPluginUpdate(item())
    expect(mocks.releases).toHaveBeenCalledTimes(1)
    scan.resolve([release()])
    await Promise.all([a, b])
    vi.advanceTimersByTime(59_999)
    await checkPluginUpdate(item())
    expect(mocks.releases).toHaveBeenCalledTimes(1)
  })

  it('does not cache source failures and allows a successful retry', async () => {
    const { checkPluginUpdate } = await import('./updates')
    mocks.releases.mockRejectedValueOnce(new Error('Source unavailable')).mockResolvedValueOnce([release()])
    await expect(checkPluginUpdate(item())).rejects.toThrow('Source unavailable')
    await expect(checkPluginUpdate(item())).resolves.toMatchObject({ status: 'available' })
    expect(mocks.releases).toHaveBeenCalledTimes(2)
  })

  it('releases a concurrency slot after a failure so queued checks can proceed', async () => {
    const { checkPluginUpdate } = await import('./updates')
    const scans = Array.from({ length: 3 }, () => deferred<PluginRelease[]>())
    mocks.releases.mockReturnValueOnce(scans[0].promise).mockReturnValueOnce(scans[1].promise).mockReturnValueOnce(scans[2].promise).mockResolvedValue([])
    const first = checkPluginUpdate(item('test/first'))
    const rejected = expect(first).rejects.toThrow('offline')
    const others = [checkPluginUpdate(item('test/second')), checkPluginUpdate(item('test/third')), checkPluginUpdate(item('test/fourth'))]
    expect(mocks.releases).toHaveBeenCalledTimes(3)
    scans[0].reject(new Error('offline'))
    await rejected
    await expect(others[2]).resolves.toMatchObject({ status: 'noRelease' })
    scans[1].resolve([]); scans[2].resolve([])
    await Promise.all(others)
    expect(mocks.releases).toHaveBeenCalledTimes(4)
  })

  it('limits simultaneous network scans to three while completing queued requests', async () => {
    const { checkPluginUpdate } = await import('./updates')
    const pending: ReturnType<typeof deferred<PluginRelease[]>>[] = []
    let active = 0, maximum = 0
    mocks.releases.mockImplementation(() => {
      const scan = deferred<PluginRelease[]>()
      pending.push(scan)
      maximum = Math.max(maximum, ++active)
      return scan.promise.finally(() => { active-- })
    })
    const requests = Array.from({ length: 8 }, (_, index) => checkPluginUpdate(item(`test/repo-${index}`)))
    expect(mocks.releases).toHaveBeenCalledTimes(3)
    for (let index = 0; index < requests.length; index++) {
      pending[index].resolve([])
      await requests[index]
    }
    expect(mocks.releases).toHaveBeenCalledTimes(8)
    expect(maximum).toBe(3)
    expect(active).toBe(0)
  })
})
