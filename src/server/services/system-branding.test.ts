import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    systemConfig: { findMany: vi.fn() },
    fileManagement: { findMany: vi.fn() },
  },
}))

vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/server/services/system-config', () => ({
  CONFIG_KEYS: {
    SYSTEM_LOGO_FILE_PATH: 'SYSTEM_LOGO_FILE_PATH',
    SYSTEM_FAVICON_FILE_PATH: 'SYSTEM_FAVICON_FILE_PATH',
  },
}))

import {
  DEFAULT_SYSTEM_FAVICON_URL,
  DEFAULT_SYSTEM_LOGO_URL,
  getSystemBranding,
  isSystemFaviconFilePath,
  isSystemLogoFilePath,
} from '@/server/services/system-branding'

describe('system branding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.systemConfig.findMany.mockResolvedValue([])
    mocks.prisma.fileManagement.findMany.mockResolvedValue([])
  })

  it('uses packaged branding when no custom configuration exists', async () => {
    await expect(getSystemBranding()).resolves.toEqual({
      logoUrl: DEFAULT_SYSTEM_LOGO_URL,
      isCustom: false,
      faviconUrl: DEFAULT_SYSTEM_FAVICON_URL,
      isFaviconCustom: false,
    })
    expect(mocks.prisma.fileManagement.findMany).not.toHaveBeenCalled()
  })

  it('resolves a managed logo and favicon independently', async () => {
    const logoPath = 'uploads/system-logo/4cc2da29-1f85-45f5-a6e3-3f54dfa0d302.png'
    const faviconPath = 'uploads/system-favicon/4384e6fc-2bbd-4b07-953c-a461fa384fc8.ico'
    mocks.prisma.systemConfig.findMany.mockResolvedValue([
      { configKey: 'SYSTEM_LOGO_FILE_PATH', configValue: logoPath },
      { configKey: 'SYSTEM_FAVICON_FILE_PATH', configValue: faviconPath },
    ])
    mocks.prisma.fileManagement.findMany.mockResolvedValue([
      { filePath: logoPath, businessType: 'SystemLogo' },
      { filePath: faviconPath, businessType: 'SystemFavicon' },
    ])

    await expect(getSystemBranding()).resolves.toEqual({
      logoUrl: `/${logoPath}`,
      isCustom: true,
      faviconUrl: `/${faviconPath}`,
      isFaviconCustom: true,
    })
  })

  it('falls back only for an unavailable individual branding resource', async () => {
    const logoPath = 'uploads/system-logo/4cc2da29-1f85-45f5-a6e3-3f54dfa0d302.png'
    const faviconPath = 'uploads/system-favicon/4384e6fc-2bbd-4b07-953c-a461fa384fc8.ico'
    mocks.prisma.systemConfig.findMany.mockResolvedValue([
      { configKey: 'SYSTEM_LOGO_FILE_PATH', configValue: logoPath },
      { configKey: 'SYSTEM_FAVICON_FILE_PATH', configValue: faviconPath },
    ])
    mocks.prisma.fileManagement.findMany.mockResolvedValue([
      { filePath: faviconPath, businessType: 'SystemFavicon' },
    ])

    await expect(getSystemBranding()).resolves.toEqual({
      logoUrl: DEFAULT_SYSTEM_LOGO_URL,
      isCustom: false,
      faviconUrl: `/${faviconPath}`,
      isFaviconCustom: true,
    })
  })

  it('falls back without querying files for malformed paths and read failures', async () => {
    mocks.prisma.systemConfig.findMany.mockResolvedValue([
      { configKey: 'SYSTEM_LOGO_FILE_PATH', configValue: 'https://example.com/logo.png' },
      { configKey: 'SYSTEM_FAVICON_FILE_PATH', configValue: 'uploads/system-favicon/not-an-icon.png' },
    ])
    await expect(getSystemBranding()).resolves.toEqual({
      logoUrl: DEFAULT_SYSTEM_LOGO_URL,
      isCustom: false,
      faviconUrl: DEFAULT_SYSTEM_FAVICON_URL,
      isFaviconCustom: false,
    })
    expect(mocks.prisma.fileManagement.findMany).not.toHaveBeenCalled()

    mocks.prisma.systemConfig.findMany.mockRejectedValue(new Error('database unavailable'))
    await expect(getSystemBranding()).resolves.toEqual({
      logoUrl: DEFAULT_SYSTEM_LOGO_URL,
      isCustom: false,
      faviconUrl: DEFAULT_SYSTEM_FAVICON_URL,
      isFaviconCustom: false,
    })
  })

  it('recognizes only contained managed branding paths', () => {
    expect(isSystemLogoFilePath('uploads/system-logo/logo.webp')).toBe(true)
    expect(isSystemLogoFilePath('uploads/project-avatar/logo.webp')).toBe(false)
    expect(isSystemLogoFilePath('uploads/system-logo/../logo.webp')).toBe(false)
    expect(isSystemLogoFilePath('uploads/system-logo/.logo.webp')).toBe(false)
    expect(isSystemFaviconFilePath('uploads/system-favicon/favicon.ico')).toBe(true)
    expect(isSystemFaviconFilePath('uploads/system-favicon/favicon.png')).toBe(false)
    expect(isSystemFaviconFilePath('uploads/system-logo/favicon.ico')).toBe(false)
    expect(isSystemFaviconFilePath('uploads/system-favicon/.favicon.ico')).toBe(false)
  })
})
