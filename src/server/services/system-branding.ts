/**
 * @file system-branding.ts
 * @project SlothVault
 * @module System Branding Configuration
 * @description Resolves the installed system's optional managed logo and favicon while retaining packaged assets as safe fallbacks.
 * @logic Read persisted branding paths, accept each only when it still belongs to the expected active managed-file record, and make visual branding failures non-blocking.
 * @dependencies Prisma SystemConfig/FileManagement models, system configuration keys
 * @index_tags branding,logo,favicon,system-config,uploads,fallback
 * @author holic512
 */
import 'server-only'

import { prisma } from '@/server/prisma'
import { CONFIG_KEYS } from '@/server/services/system-config'
import type { SystemBranding } from '@/types/branding'

export const DEFAULT_SYSTEM_LOGO_URL = '/logo.png'
export const DEFAULT_SYSTEM_FAVICON_URL = '/favicon.ico'

const DEFAULT_BRANDING: SystemBranding = {
  logoUrl: DEFAULT_SYSTEM_LOGO_URL,
  isCustom: false,
  faviconUrl: DEFAULT_SYSTEM_FAVICON_URL,
  isFaviconCustom: false,
}

export function isSystemLogoFilePath(value: string) {
  if (!value || value.includes('\\') || value.includes('\0')) return false
  const segments = value.split('/')
  return (
    segments.length === 3 &&
    segments[0] === 'uploads' &&
    segments[1] === 'system-logo' &&
    Boolean(segments[2]) &&
    !segments[2].startsWith('.')
  )
}

export function isSystemFaviconFilePath(value: string) {
  if (!value || value.includes('\\') || value.includes('\0')) return false
  const segments = value.split('/')
  return (
    segments.length === 3 &&
    segments[0] === 'uploads' &&
    segments[1] === 'system-favicon' &&
    segments[2].endsWith('.ico') &&
    segments[2].length > '.ico'.length &&
    !segments[2].startsWith('.')
  )
}

export async function getSystemBranding(): Promise<SystemBranding> {
  try {
    const configs = await prisma.systemConfig.findMany({
      where: {
        configKey: {
          in: [
            CONFIG_KEYS.SYSTEM_LOGO_FILE_PATH,
            CONFIG_KEYS.SYSTEM_FAVICON_FILE_PATH,
          ],
        },
      },
      select: { configKey: true, configValue: true },
    })
    const configValues = new Map(configs.map((config) => [config.configKey, config.configValue]))
    const logoPath = configValues.get(CONFIG_KEYS.SYSTEM_LOGO_FILE_PATH) || ''
    const faviconPath = configValues.get(CONFIG_KEYS.SYSTEM_FAVICON_FILE_PATH) || ''
    const candidates = [
      isSystemLogoFilePath(logoPath)
        ? { filePath: logoPath, businessType: 'SystemLogo' }
        : null,
      isSystemFaviconFilePath(faviconPath)
        ? { filePath: faviconPath, businessType: 'SystemFavicon' }
        : null,
    ].filter((candidate): candidate is { filePath: string; businessType: 'SystemLogo' | 'SystemFavicon' } => candidate !== null)
    if (!candidates.length) return DEFAULT_BRANDING

    const files = await prisma.fileManagement.findMany({
      where: {
        filePath: { in: candidates.map((candidate) => candidate.filePath) },
        status: 1,
      },
      select: { filePath: true, businessType: true },
    })
    const activeFiles = new Set(files.map((file) => `${file.businessType}:${file.filePath}`))
    const hasLogo = activeFiles.has(`SystemLogo:${logoPath}`)
    const hasFavicon = activeFiles.has(`SystemFavicon:${faviconPath}`)

    return {
      logoUrl: hasLogo ? `/${logoPath}` : DEFAULT_SYSTEM_LOGO_URL,
      isCustom: hasLogo,
      faviconUrl: hasFavicon ? `/${faviconPath}` : DEFAULT_SYSTEM_FAVICON_URL,
      isFaviconCustom: hasFavicon,
    }
  } catch {
    return DEFAULT_BRANDING
  }
}
