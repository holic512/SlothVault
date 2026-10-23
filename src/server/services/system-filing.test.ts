import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/server/prisma', () => ({ prisma: { systemConfig: { findMany: mocks.findMany } } }))

import { CONFIG_KEYS } from './system-config'
import { getSystemFiling } from './system-filing'

describe('public system filing', () => {
  beforeEach(() => {
    mocks.findMany.mockReset().mockResolvedValue([])
  })

  it('returns no filings for missing settings and selects only filing content and visibility', async () => {
    await expect(getSystemFiling()).resolves.toEqual({ icp: null, publicSecurity: null })
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { configKey: { in: [
        CONFIG_KEYS.SYSTEM_FILING_ENABLED,
        CONFIG_KEYS.SYSTEM_ICP_RECORD_NUMBER, CONFIG_KEYS.SYSTEM_ICP_RECORD_URL,
        CONFIG_KEYS.SYSTEM_PUBLIC_SECURITY_RECORD_NUMBER, CONFIG_KEYS.SYSTEM_PUBLIC_SECURITY_RECORD_URL,
      ] } },
      select: { configKey: true, configValue: true },
    })
  })

  it('hides both configured records when disabled and restores them on the next enabled read', async () => {
    const records = [
      { configKey: CONFIG_KEYS.SYSTEM_ICP_RECORD_NUMBER, configValue: 'Saved ICP filing' },
      { configKey: CONFIG_KEYS.SYSTEM_ICP_RECORD_URL, configValue: 'https://example.com/icp' },
      { configKey: CONFIG_KEYS.SYSTEM_PUBLIC_SECURITY_RECORD_NUMBER, configValue: 'Saved public security filing' },
      { configKey: CONFIG_KEYS.SYSTEM_PUBLIC_SECURITY_RECORD_URL, configValue: 'https://example.com/security' },
    ]
    mocks.findMany.mockResolvedValueOnce([
      ...records, { configKey: CONFIG_KEYS.SYSTEM_FILING_ENABLED, configValue: 'false' },
    ]).mockResolvedValueOnce([
      ...records, { configKey: CONFIG_KEYS.SYSTEM_FILING_ENABLED, configValue: 'true' },
    ])
    await expect(getSystemFiling()).resolves.toEqual({ icp: null, publicSecurity: null })
    await expect(getSystemFiling()).resolves.toEqual({
      icp: { number: 'Saved ICP filing', url: 'https://example.com/icp' },
      publicSecurity: { number: 'Saved public security filing', url: 'https://example.com/security' },
    })
  })

  it('does not produce records when enabled without filing numbers', async () => {
    mocks.findMany.mockResolvedValue([
      { configKey: CONFIG_KEYS.SYSTEM_FILING_ENABLED, configValue: 'true' },
      { configKey: CONFIG_KEYS.SYSTEM_ICP_RECORD_URL, configValue: 'https://example.com/icp' },
    ])
    await expect(getSystemFiling()).resolves.toEqual({ icp: null, publicSecurity: null })
  })

  it('resolves ICP independently and trims stored values', async () => {
    mocks.findMany.mockResolvedValue([
      { configKey: CONFIG_KEYS.SYSTEM_ICP_RECORD_NUMBER, configValue: ' 测试ICP备12345678号-1 ' },
      { configKey: CONFIG_KEYS.SYSTEM_ICP_RECORD_URL, configValue: ' https://example.com/icp ' },
    ])
    await expect(getSystemFiling()).resolves.toEqual({
      icp: { number: '测试ICP备12345678号-1', url: 'https://example.com/icp' },
      publicSecurity: null,
    })
  })

  it('accepts public security without ICP and omits link-only entries', async () => {
    mocks.findMany.mockResolvedValue([
      { configKey: CONFIG_KEYS.SYSTEM_ICP_RECORD_URL, configValue: 'https://example.com/icp' },
      { configKey: CONFIG_KEYS.SYSTEM_PUBLIC_SECURITY_RECORD_NUMBER, configValue: '测试公网安备12345678901234号' },
    ])
    await expect(getSystemFiling()).resolves.toEqual({
      icp: null,
      publicSecurity: { number: '测试公网安备12345678901234号', url: '' },
    })
  })

  it.each(['', 'not a URL', '/relative', 'javascript:alert(1)', 'data:text/html,test', 'ftp://example.com'])
    ('keeps the number readable while discarding an absent or unsafe link: %s', async (url) => {
      mocks.findMany.mockResolvedValue([
        { configKey: CONFIG_KEYS.SYSTEM_ICP_RECORD_NUMBER, configValue: '测试ICP备12345678号-1' },
        { configKey: CONFIG_KEYS.SYSTEM_ICP_RECORD_URL, configValue: url },
      ])
      await expect(getSystemFiling()).resolves.toMatchObject({
        icp: { number: '测试ICP备12345678号-1', url: '' },
      })
    })

  it('reads changed database values again instead of caching previous filings', async () => {
    mocks.findMany.mockResolvedValueOnce([
      { configKey: CONFIG_KEYS.SYSTEM_ICP_RECORD_NUMBER, configValue: 'old' },
    ]).mockResolvedValueOnce([
      { configKey: CONFIG_KEYS.SYSTEM_ICP_RECORD_NUMBER, configValue: 'new' },
      { configKey: CONFIG_KEYS.SYSTEM_PUBLIC_SECURITY_RECORD_NUMBER, configValue: 'security' },
    ]).mockResolvedValueOnce([
      { configKey: CONFIG_KEYS.SYSTEM_PUBLIC_SECURITY_RECORD_NUMBER, configValue: '   ' },
    ])
    await expect(getSystemFiling()).resolves.toMatchObject({ icp: { number: 'old' } })
    await expect(getSystemFiling()).resolves.toMatchObject({ icp: { number: 'new' }, publicSecurity: { number: 'security' } })
    await expect(getSystemFiling()).resolves.toEqual({ icp: null, publicSecurity: null })
  })

  it('does not throw when the installed database cannot be read', async () => {
    mocks.findMany.mockRejectedValue(new Error('database unavailable'))
    await expect(getSystemFiling()).resolves.toEqual({ icp: null, publicSecurity: null })
  })
})
