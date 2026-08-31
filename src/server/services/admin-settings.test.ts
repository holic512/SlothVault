import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configKeys: {
    SYSTEM_LOGO_FILE_PATH: 'SYSTEM_LOGO_FILE_PATH',
    SYSTEM_FAVICON_FILE_PATH: 'SYSTEM_FAVICON_FILE_PATH',
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

vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/server/services/system-config', () => ({ CONFIG_KEYS: mocks.configKeys }))
vi.mock('@/server/services/system-branding', () => ({
  getSystemBranding: mocks.getSystemBranding,
  isSystemLogoFilePath: (value: string) =>
    value.startsWith('uploads/system-logo/') && !value.includes('..'),
  isSystemFaviconFilePath: (value: string) =>
    value.startsWith('uploads/system-favicon/') && value.endsWith('.ico') && !value.includes('..'),
}))

import { updateAdminSettings } from '@/server/services/admin-settings'

describe('admin branding settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.systemConfig.findMany.mockResolvedValue([])
    mocks.transaction.fileManagement.findFirst.mockResolvedValue({ id: 41 })
    mocks.transaction.systemConfig.upsert.mockResolvedValue({ id: 1 })
    mocks.prisma.$transaction.mockImplementation(async (operation) => operation(mocks.transaction))
  })

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
