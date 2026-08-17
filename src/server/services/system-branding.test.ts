import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    systemConfig: { findUnique: vi.fn() },
    fileManagement: { findFirst: vi.fn() },
  },
}))

vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/server/services/system-config', () => ({
  CONFIG_KEYS: { SYSTEM_LOGO_FILE_PATH: 'SYSTEM_LOGO_FILE_PATH' },
}))

import {
  DEFAULT_SYSTEM_LOGO_URL,
  getSystemBranding,
  isSystemLogoFilePath,
} from '@/server/services/system-branding'

describe('system branding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the packaged logo when no custom configuration exists', async () => {
    mocks.prisma.systemConfig.findUnique.mockResolvedValue(null)

    await expect(getSystemBranding()).resolves.toEqual({
      logoUrl: DEFAULT_SYSTEM_LOGO_URL,
      isCustom: false,
    })
    expect(mocks.prisma.fileManagement.findFirst).not.toHaveBeenCalled()
  })

  it('uses an active managed system logo', async () => {
    const filePath = 'uploads/system-logo/4cc2da29-1f85-45f5-a6e3-3f54dfa0d302.png'
    mocks.prisma.systemConfig.findUnique.mockResolvedValue({ configValue: filePath })
    mocks.prisma.fileManagement.findFirst.mockResolvedValue({ filePath })

    await expect(getSystemBranding()).resolves.toEqual({
      logoUrl: `/${filePath}`,
      isCustom: true,
    })
  })

  it('falls back when the configured path is malformed or no longer active', async () => {
    mocks.prisma.systemConfig.findUnique.mockResolvedValue({ configValue: 'https://example.com/logo.png' })
    await expect(getSystemBranding()).resolves.toEqual({
      logoUrl: DEFAULT_SYSTEM_LOGO_URL,
      isCustom: false,
    })

    mocks.prisma.systemConfig.findUnique.mockResolvedValue({
      configValue: 'uploads/system-logo/removed.png',
    })
    mocks.prisma.fileManagement.findFirst.mockResolvedValue(null)
    await expect(getSystemBranding()).resolves.toEqual({
      logoUrl: DEFAULT_SYSTEM_LOGO_URL,
      isCustom: false,
    })
  })

  it('never lets a branding read failure block the page shell', async () => {
    mocks.prisma.systemConfig.findUnique.mockRejectedValue(new Error('database unavailable'))

    await expect(getSystemBranding()).resolves.toEqual({
      logoUrl: DEFAULT_SYSTEM_LOGO_URL,
      isCustom: false,
    })
  })

  it('recognizes only contained system-logo upload paths', () => {
    expect(isSystemLogoFilePath('uploads/system-logo/logo.webp')).toBe(true)
    expect(isSystemLogoFilePath('uploads/project-avatar/logo.webp')).toBe(false)
    expect(isSystemLogoFilePath('uploads/system-logo/../logo.webp')).toBe(false)
    expect(isSystemLogoFilePath('uploads/system-logo/.logo.webp')).toBe(false)
  })
})
