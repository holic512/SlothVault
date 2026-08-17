import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configKeys: {
    SYSTEM_LOGO_FILE_PATH: 'SYSTEM_LOGO_FILE_PATH',
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
}))

import { updateAdminSettings } from '@/server/services/admin-settings'

describe('admin system-logo settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.systemConfig.findMany.mockResolvedValue([])
    mocks.transaction.fileManagement.findFirst.mockResolvedValue({ id: 41 })
    mocks.transaction.systemConfig.upsert.mockResolvedValue({ id: 1 })
    mocks.prisma.$transaction.mockImplementation(async (operation) => operation(mocks.transaction))
  })

  it('accepts an active managed system-logo path', async () => {
    const filePath = 'uploads/system-logo/08bb17d6-8425-4f34-a107-735a6a4cdcda.png'

    await expect(updateAdminSettings([{
      key: mocks.configKeys.SYSTEM_LOGO_FILE_PATH,
      value: filePath,
    }])).resolves.toMatchObject({ updated: 1 })

    expect(mocks.transaction.fileManagement.findFirst).toHaveBeenCalledWith({
      where: { filePath, businessType: 'SystemLogo', status: 1 },
      select: { id: true },
    })
    expect(mocks.transaction.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ configValue: filePath }),
    }))
  })

  it('accepts an empty path to restore the packaged default', async () => {
    await expect(updateAdminSettings([{
      key: mocks.configKeys.SYSTEM_LOGO_FILE_PATH,
      value: '',
    }])).resolves.toMatchObject({ updated: 1 })

    expect(mocks.transaction.fileManagement.findFirst).not.toHaveBeenCalled()
    expect(mocks.transaction.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ configValue: '' }),
    }))
  })

  it('rejects external URLs and paths from another upload type', async () => {
    await expect(updateAdminSettings([{
      key: mocks.configKeys.SYSTEM_LOGO_FILE_PATH,
      value: 'https://example.com/logo.png',
    }])).rejects.toThrow('must reference a managed system logo')

    await expect(updateAdminSettings([{
      key: mocks.configKeys.SYSTEM_LOGO_FILE_PATH,
      value: 'uploads/project-avatar/logo.png',
    }])).rejects.toThrow('must reference a managed system logo')
  })

  it('rejects a managed path whose active SystemLogo record no longer exists', async () => {
    mocks.transaction.fileManagement.findFirst.mockResolvedValue(null)

    await expect(updateAdminSettings([{
      key: mocks.configKeys.SYSTEM_LOGO_FILE_PATH,
      value: 'uploads/system-logo/missing.png',
    }])).rejects.toThrow('The selected system logo is unavailable')
    expect(mocks.transaction.systemConfig.upsert).not.toHaveBeenCalled()
  })
})
