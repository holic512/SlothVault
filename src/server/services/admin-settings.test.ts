import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configKeys: {
    SYSTEM_LOGO_FILE_PATH: 'SYSTEM_LOGO_FILE_PATH',
    SYSTEM_FAVICON_FILE_PATH: 'SYSTEM_FAVICON_FILE_PATH',
    SYSTEM_ICP_RECORD_NUMBER: 'SYSTEM_ICP_RECORD_NUMBER',
    SYSTEM_ICP_RECORD_URL: 'SYSTEM_ICP_RECORD_URL',
    SYSTEM_PUBLIC_SECURITY_RECORD_NUMBER: 'SYSTEM_PUBLIC_SECURITY_RECORD_NUMBER',
    SYSTEM_PUBLIC_SECURITY_RECORD_URL: 'SYSTEM_PUBLIC_SECURITY_RECORD_URL',
    DEFAULT_NETWORK: 'SOLANA_DEFAULT_NETWORK',
    MAINNET_ENABLED: 'SOLANA_MAINNET_ENABLED',
    MAINNET_RPC_PRIMARY: 'SOLANA_MAINNET_RPC_PRIMARY',
    MAINNET_RPC_FALLBACK: 'SOLANA_MAINNET_RPC_FALLBACK',
    DEVNET_ENABLED: 'SOLANA_DEVNET_ENABLED',
    DEVNET_RPC_PRIMARY: 'SOLANA_DEVNET_RPC_PRIMARY',
    DEVNET_RPC_FALLBACK: 'SOLANA_DEVNET_RPC_FALLBACK',
  },
  prisma: {
    systemConfig: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  transaction: {
    fileManagement: { findFirst: vi.fn() },
    systemConfig: { upsert: vi.fn() },
  },
  getSystemBranding: vi.fn(),
}))

vi.mock('@/server/services/file-references', () => ({ indexFileWrite: (_tx: unknown, _type: unknown, write: Promise<unknown>) => write, syncFileReferences: vi.fn() }))

vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/server/services/system-config', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/server/services/system-config')>(),
  CONFIG_KEYS: mocks.configKeys,
}))
vi.mock('@/server/services/system-branding', () => ({
  getSystemBranding: mocks.getSystemBranding,
  isSystemLogoFilePath: (value: string) =>
    value.startsWith('uploads/system-logo/') && !value.includes('..'),
  isSystemFaviconFilePath: (value: string) =>
    value.startsWith('uploads/system-favicon/') && value.endsWith('.ico') && !value.includes('..'),
}))

import { listAdminSettings, updateAdminSettings } from '@/server/services/admin-settings'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.systemConfig.findMany.mockResolvedValue([])
  mocks.transaction.fileManagement.findFirst.mockResolvedValue({ id: 41 })
  mocks.transaction.systemConfig.upsert.mockResolvedValue({ id: 1 })
  mocks.prisma.$transaction.mockImplementation(async (operation) => operation(mocks.transaction))
  mocks.getSystemBranding.mockResolvedValue({
    logoUrl: '/logo.png', isCustom: false, faviconUrl: '/favicon.ico', isFaviconCustom: false,
  })
})

describe('admin branding settings', () => {
  it('accepts active managed logo and favicon paths in the same atomic save', async () => {
    const logoPath = 'uploads/system-logo/08bb17d6-8425-4f34-a107-735a6a4cdcda.png'
    const faviconPath = 'uploads/system-favicon/a22570cf-2906-4698-a1c3-88d625a60231.ico'

    await expect(updateAdminSettings([
      { key: mocks.configKeys.SYSTEM_LOGO_FILE_PATH, value: logoPath },
      { key: mocks.configKeys.SYSTEM_FAVICON_FILE_PATH, value: faviconPath },
    ])).resolves.toMatchObject({ updated: 2 })

    expect(mocks.transaction.fileManagement.findFirst).toHaveBeenCalledWith({
      where: { filePath: logoPath, businessType: 'SystemLogo', status: 1 },
      select: { id: true },
    })
    expect(mocks.transaction.fileManagement.findFirst).toHaveBeenCalledWith({
      where: { filePath: faviconPath, businessType: 'SystemFavicon', status: 1 },
      select: { id: true },
    })
  })

  it('accepts empty branding paths to restore each packaged default independently', async () => {
    await expect(updateAdminSettings([
      { key: mocks.configKeys.SYSTEM_LOGO_FILE_PATH, value: '' },
      { key: mocks.configKeys.SYSTEM_FAVICON_FILE_PATH, value: '' },
    ])).resolves.toMatchObject({ updated: 2 })
    expect(mocks.transaction.fileManagement.findFirst).not.toHaveBeenCalled()
  })

  it('rejects external URLs, wrong managed paths, and unavailable favicon records', async () => {
    await expect(updateAdminSettings([{
      key: mocks.configKeys.SYSTEM_FAVICON_FILE_PATH,
      value: 'https://example.com/favicon.ico',
    }])).rejects.toThrow('must reference a managed system favicon')

    await expect(updateAdminSettings([{
      key: mocks.configKeys.SYSTEM_FAVICON_FILE_PATH,
      value: 'uploads/system-logo/favicon.ico',
    }])).rejects.toThrow('must reference a managed system favicon')

    mocks.transaction.fileManagement.findFirst.mockResolvedValue(null)
    await expect(updateAdminSettings([{
      key: mocks.configKeys.SYSTEM_FAVICON_FILE_PATH,
      value: 'uploads/system-favicon/missing.ico',
    }])).rejects.toThrow('The selected system favicon is unavailable')
  })
})

describe('admin filing settings', () => {
  const filingKeys = [
    mocks.configKeys.SYSTEM_ICP_RECORD_NUMBER,
    mocks.configKeys.SYSTEM_ICP_RECORD_URL,
    mocks.configKeys.SYSTEM_PUBLIC_SECURITY_RECORD_NUMBER,
    mocks.configKeys.SYSTEM_PUBLIC_SECURITY_RECORD_URL,
  ]

  it('lists four optional, non-sensitive filing settings with empty defaults', async () => {
    const settings = await listAdminSettings()
    const filing = settings.groups.find((group) => group.key === 'filing')
    expect(filing?.configs.map((config) => config.key)).toEqual(filingKeys)
    for (const config of filing!.configs) {
      expect(config).toMatchObject({ value: '', defaultValue: '', sensitive: false, configured: false })
    }
  })

  it('saves just an ICP number without requiring public security or any link', async () => {
    await expect(updateAdminSettings([{
      key: mocks.configKeys.SYSTEM_ICP_RECORD_NUMBER,
      value: '  测试ICP备12345678号-1  ',
    }])).resolves.toMatchObject({ updated: 1 })
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce()
    expect(mocks.transaction.systemConfig.upsert).toHaveBeenCalledOnce()
    expect(mocks.transaction.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { configKey: mocks.configKeys.SYSTEM_ICP_RECORD_NUMBER },
      create: expect.objectContaining({ configValue: '测试ICP备12345678号-1' }),
    }))
  })

  it('saves both filings and trims HTTP(S) links in one transaction', async () => {
    await expect(updateAdminSettings([
      { key: filingKeys[0], value: '测试ICP备12345678号-1' },
      { key: filingKeys[1], value: ' https://example.com/icp ' },
      { key: filingKeys[2], value: '测试公网安备12345678901234号' },
      { key: filingKeys[3], value: ' http://example.com/security ' },
    ])).resolves.toMatchObject({ updated: 4 })
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce()
    expect(mocks.transaction.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { configKey: filingKeys[1] },
      create: expect.objectContaining({ configValue: 'https://example.com/icp' }),
    }))
  })

  it('accepts clearing all filing fields including whitespace-only values', async () => {
    await expect(updateAdminSettings(filingKeys.map((key) => ({ key, value: '   ' }))))
      .resolves.toMatchObject({ updated: 4 })
    for (const [args] of mocks.transaction.systemConfig.upsert.mock.calls) {
      expect(args.update.configValue).toBe('')
    }
  })

  it.each(filingKeys)('rejects values exceeding the storage limit for %s', async (key) => {
    await expect(updateAdminSettings([{ key, value: 'a'.repeat(501) }]))
      .rejects.toThrow('exceeds 500 characters')
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('accepts a filing number exactly at the storage limit', async () => {
    await expect(updateAdminSettings([{ key: filingKeys[0], value: 'a'.repeat(500) }]))
      .resolves.toMatchObject({ updated: 1 })
  })

  it.each(['not a URL', '/relative', 'javascript:alert(1)', 'data:text/html,test', 'ftp://example.com'])
    ('rejects unsafe links without saving other changes: %s', async (value) => {
      await expect(updateAdminSettings([
        { key: filingKeys[0], value: 'Must not be saved' },
        { key: filingKeys[3], value },
      ])).rejects.toMatchObject({ status: 400 })
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
      expect(mocks.transaction.systemConfig.upsert).not.toHaveBeenCalled()
    })
})

describe('administrator RPC configuration', () => {
  const rpcKeys = [mocks.configKeys.MAINNET_RPC_PRIMARY, mocks.configKeys.MAINNET_RPC_FALLBACK,
    mocks.configKeys.DEVNET_RPC_PRIMARY, mocks.configKeys.DEVNET_RPC_FALLBACK]

  it('returns every saved RPC address intact as a non-sensitive ordinary URL', async () => {
    mocks.prisma.systemConfig.findMany.mockResolvedValue(rpcKeys.map((configKey, index) => ({
      configKey, configValue: `https://rpc-${index}.example.test/path?key=example`,
    })))
    const settings = await listAdminSettings()
    for (const [index, key] of rpcKeys.entries()) {
      expect(settings.configs.find((item) => item.key === key)).toMatchObject({
        value: `https://rpc-${index}.example.test/path?key=example`,
        effectiveValue: `https://rpc-${index}.example.test/path?key=example`,
        sensitive: false, configured: true, kind: 'url',
      })
    }
  })

  it('keeps environment defaults out of the stored value and exposes the effective address separately', async () => {
    vi.stubEnv('SOLANA_RPC_URL', 'https://mainnet-default.example.test')
    vi.stubEnv('SOLANA_MAINNET_RPC_FALLBACK', '')
    try {
      const settings = await listAdminSettings()
      expect(settings.configs.find((item) => item.key === rpcKeys[0])).toMatchObject({
        value: '', effectiveValue: 'https://mainnet-default.example.test', configured: false,
      })
      expect(settings.configs.find((item) => item.key === rpcKeys[1])).toMatchObject({ value: '', effectiveValue: '' })
    } finally { vi.unstubAllEnvs() }
  })

  it('persists clearing saved nodes without requiring a secret-clear flag', async () => {
    mocks.prisma.systemConfig.findMany.mockResolvedValue(rpcKeys.map((configKey) => ({ configKey, configValue: 'https://old.example.test' })))
    await expect(updateAdminSettings(rpcKeys.map((key) => ({ key, value: '  ' })))).resolves.toMatchObject({ updated: 4 })
    expect(mocks.transaction.systemConfig.upsert).toHaveBeenCalledTimes(4)
    for (const [args] of mocks.transaction.systemConfig.upsert.mock.calls) expect(args.update.configValue).toBe('')
  })

  it('rejects invalid RPC URLs atomically', async () => {
    await expect(updateAdminSettings([
      { key: rpcKeys[0], value: 'https://valid.example.test' },
      { key: rpcKeys[1], value: 'ftp://invalid.example.test' },
    ])).rejects.toMatchObject({ status: 400 })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })
})
