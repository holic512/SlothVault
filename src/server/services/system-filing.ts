/**
 * @file system-filing.ts
 * @project SlothVault
 * @module Public System Filing
 * @description Resolves independently optional ICP and public security filing records from the installed database.
 * @logic Read only filing keys on every call, omit records without numbers, filter unsafe links, and make storage failures non-blocking.
 * @dependencies Prisma SystemConfig model, system configuration keys
 * @index_tags filing,icp,public-security,system-config,public,footer
 * @author holic512
 */
import 'server-only'

import { prisma } from '@/server/prisma'
import { CONFIG_KEYS } from '@/server/services/system-config'

export type SystemFilingRecord = { number: string; url: string }
export type SystemFiling = {
  icp: SystemFilingRecord | null
  publicSecurity: SystemFilingRecord | null
}

function filingRecord(number: string, url: string): SystemFilingRecord | null {
  const trimmedNumber = number.trim()
  if (!trimmedNumber) return null

  const trimmedUrl = url.trim()
  try {
    const parsed = new URL(trimmedUrl)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return { number: trimmedNumber, url: trimmedUrl }
    }
  } catch {
    // An absent or invalid optional link leaves the filing number readable.
  }
  return { number: trimmedNumber, url: '' }
}

export async function getSystemFiling(): Promise<SystemFiling> {
  try {
    const configs = await prisma.systemConfig.findMany({
      where: {
        configKey: {
          in: [
            CONFIG_KEYS.SYSTEM_ICP_RECORD_NUMBER,
            CONFIG_KEYS.SYSTEM_ICP_RECORD_URL,
            CONFIG_KEYS.SYSTEM_PUBLIC_SECURITY_RECORD_NUMBER,
            CONFIG_KEYS.SYSTEM_PUBLIC_SECURITY_RECORD_URL,
          ],
        },
      },
      select: { configKey: true, configValue: true },
    })
    const values = new Map(configs.map((config) => [config.configKey, config.configValue]))
    return {
      icp: filingRecord(
        values.get(CONFIG_KEYS.SYSTEM_ICP_RECORD_NUMBER) || '',
        values.get(CONFIG_KEYS.SYSTEM_ICP_RECORD_URL) || '',
      ),
      publicSecurity: filingRecord(
        values.get(CONFIG_KEYS.SYSTEM_PUBLIC_SECURITY_RECORD_NUMBER) || '',
        values.get(CONFIG_KEYS.SYSTEM_PUBLIC_SECURITY_RECORD_URL) || '',
      ),
    }
  } catch {
    return { icp: null, publicSecurity: null }
  }
}
