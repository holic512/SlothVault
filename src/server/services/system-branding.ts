/**
 * @file system-branding.ts
 * @project SlothVault
 * @module System Branding Configuration
 * @description Resolves the installed system's optional managed logo while retaining the packaged mark as a safe fallback.
 * @logic Read one persisted upload path, accept it only when it still belongs to an active SystemLogo record, and make visual branding failures non-blocking.
 * @dependencies Prisma SystemConfig/FileManagement models, system configuration keys
 * @index_tags branding,logo,system-config,uploads,fallback
 * @author holic512
 */
import 'server-only'

import { prisma } from '@/server/prisma'
import { CONFIG_KEYS } from '@/server/services/system-config'
import type { SystemBranding } from '@/types/branding'

export const DEFAULT_SYSTEM_LOGO_URL = '/logo.png'

const DEFAULT_BRANDING: SystemBranding = {
  logoUrl: DEFAULT_SYSTEM_LOGO_URL,
  isCustom: false,
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

export async function getSystemBranding(): Promise<SystemBranding> {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { configKey: CONFIG_KEYS.SYSTEM_LOGO_FILE_PATH },
      select: { configValue: true },
    })
    const filePath = config?.configValue || ''
    if (!isSystemLogoFilePath(filePath)) return DEFAULT_BRANDING

    const file = await prisma.fileManagement.findFirst({
      where: { filePath, businessType: 'SystemLogo', status: 1 },
      select: { filePath: true },
    })
    if (!file) return DEFAULT_BRANDING

    return { logoUrl: `/${file.filePath}`, isCustom: true }
  } catch {
    return DEFAULT_BRANDING
  }
}
