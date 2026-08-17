/**
 * @file admin-settings.ts
 * @project SlothVault
 * @module Admin Settings Service
 * @description Owns installed-system branding and fixed Solana evidence network profiles, masked RPC reads, validated writes, and database-backed refresh checks.
 * @logic Join stored rows with a typed registry, validate managed logo references without echoing RPC endpoints, reject invalid defaults or disabled default networks, and persist changes atomically.
 * @dependencies Prisma SystemConfig/FileManagement models, server/http/errors, system configuration and branding services
 * @index_tags admin,settings,branding,logo,solana,evidence,rpc,validation,transaction
 * @author holic512
 */
import 'server-only'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { CONFIG_KEYS } from '@/server/services/system-config'
import {
  getSystemBranding,
  isSystemLogoFilePath,
} from '@/server/services/system-branding'

export const ADMIN_CONFIG_DEFINITIONS = [
  {
    key: CONFIG_KEYS.SYSTEM_LOGO_FILE_PATH,
    group: 'branding',
    kind: 'image',
    sensitive: false,
    description: 'Optional managed logo displayed across the installed system',
    defaultValue: '',
  },
  {
    key: CONFIG_KEYS.DEFAULT_NETWORK,
    group: 'evidence',
    kind: 'network',
    sensitive: false,
    description: 'Default network for new transaction evidence',
    defaultValue: 'devnet',
  },
  {
    key: CONFIG_KEYS.MAINNET_ENABLED,
    group: 'evidence',
    kind: 'boolean',
    sensitive: false,
    description: 'Allow formal Mainnet evidence issuance',
    defaultValue: 'false',
  },
  {
    key: CONFIG_KEYS.MAINNET_RPC_PRIMARY,
    group: 'evidence',
    kind: 'url',
    sensitive: true,
    description: 'Mainnet primary RPC endpoint',
    defaultValue: '',
  },
  {
    key: CONFIG_KEYS.MAINNET_RPC_FALLBACK,
    group: 'evidence',
    kind: 'url',
    sensitive: true,
    description: 'Mainnet fallback RPC endpoint',
    defaultValue: '',
  },
  {
    key: CONFIG_KEYS.DEVNET_ENABLED,
    group: 'evidence',
    kind: 'boolean',
    sensitive: false,
    description: 'Allow Devnet test evidence issuance',
    defaultValue: 'true',
  },
  {
    key: CONFIG_KEYS.DEVNET_RPC_PRIMARY,
    group: 'evidence',
    kind: 'url',
    sensitive: true,
    description: 'Devnet primary RPC endpoint',
    defaultValue: '',
  },
  {
    key: CONFIG_KEYS.DEVNET_RPC_FALLBACK,
    group: 'evidence',
    kind: 'url',
    sensitive: true,
    description: 'Devnet fallback RPC endpoint',
    defaultValue: '',
  },
] as const

export type AdminConfigKey = (typeof ADMIN_CONFIG_DEFINITIONS)[number]['key']
export type AdminConfigChange = { key: string; value: string; clear?: boolean }

function configDefinition(key: string) {
  return ADMIN_CONFIG_DEFINITIONS.find((item) => item.key === key)
}

function validateConfigValue(
  definition: (typeof ADMIN_CONFIG_DEFINITIONS)[number],
  value: string,
) {
  if (value.length > 500) throw new HttpError(`${definition.key} exceeds 500 characters`, 400, 400)
  if (definition.kind === 'url' && value) {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      throw new HttpError(`${definition.key} must be a valid URL`, 400, 400)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new HttpError(`${definition.key} must use HTTP(S)`, 400, 400)
    }
  }
  if (definition.kind === 'boolean' && value !== 'true' && value !== 'false') {
    throw new HttpError(`${definition.key} must be true or false`, 400, 400)
  }
  if (definition.kind === 'network' && value !== 'mainnet' && value !== 'devnet') {
    throw new HttpError(`${definition.key} must be mainnet or devnet`, 400, 400)
  }
  if (definition.kind === 'image' && value && !isSystemLogoFilePath(value)) {
    throw new HttpError(`${definition.key} must reference a managed system logo`, 400, 400)
  }
  return value
}

export async function listAdminSettings() {
  const [records, branding] = await Promise.all([
    prisma.systemConfig.findMany({
      where: { configKey: { in: ADMIN_CONFIG_DEFINITIONS.map((item) => item.key) } },
    }),
    getSystemBranding(),
  ])
  const byKey = new Map(records.map((record) => [record.configKey, record.configValue]))
  const configs = ADMIN_CONFIG_DEFINITIONS.map((definition) => {
    const storedValue = byKey.get(definition.key) || ''
    return {
      key: definition.key,
      value: definition.sensitive ? '' : storedValue || definition.defaultValue,
      description: definition.description,
      defaultValue: definition.defaultValue,
      kind: definition.kind,
      sensitive: definition.sensitive,
      configured: Boolean(storedValue),
      previewUrl: definition.kind === 'image' ? branding.logoUrl : undefined,
      isCustom: definition.kind === 'image' ? branding.isCustom : undefined,
    }
  })
  return {
    configs,
    groups: ADMIN_CONFIG_DEFINITIONS
      .map((definition) => definition.group)
      .filter((group, index, groups) => groups.indexOf(group) === index)
      .map((group) => ({
        key: group,
        label: group,
        configs: configs.filter((config) => configDefinition(config.key)?.group === group),
      })),
  }
}

export async function updateAdminSettings(configs: AdminConfigChange[]) {
  const seen = new Set<string>()
  const records = await prisma.systemConfig.findMany({
    where: { configKey: { in: ADMIN_CONFIG_DEFINITIONS.map((item) => item.key) } },
  })
  const effective = new Map(
    ADMIN_CONFIG_DEFINITIONS.map((item) => [
      item.key,
      records.find((record) => record.configKey === item.key)?.configValue || item.defaultValue,
    ]),
  )
  const changes: Array<{ key: AdminConfigKey; value: string; description: string }> = []
  for (const item of configs) {
    if (seen.has(item.key)) throw new HttpError(`Duplicate config key: ${item.key}`, 400, 400)
    seen.add(item.key)
    const definition = configDefinition(item.key)
    if (!definition) throw new HttpError(`Unknown config key: ${item.key}`, 400, 400)
    if (definition.sensitive && item.value === '' && item.clear !== true) continue
    const value = validateConfigValue(definition, item.value.trim())
    effective.set(definition.key, value)
    changes.push({ key: definition.key, value, description: definition.description })
  }
  if (!changes.length) throw new HttpError('No configuration changes to save', 400, 400)

  const defaultNetwork = effective.get(CONFIG_KEYS.DEFAULT_NETWORK)
  const enabledKey = defaultNetwork === 'mainnet'
    ? CONFIG_KEYS.MAINNET_ENABLED
    : CONFIG_KEYS.DEVNET_ENABLED
  if (effective.get(enabledKey) !== 'true') {
    throw new HttpError('The default evidence network must be enabled', 400, 400)
  }

  await prisma.$transaction(async (tx) => {
    const logoPath = effective.get(CONFIG_KEYS.SYSTEM_LOGO_FILE_PATH) || ''
    if (logoPath) {
      const logo = await tx.fileManagement.findFirst({
        where: { filePath: logoPath, businessType: 'SystemLogo', status: 1 },
        select: { id: true },
      })
      if (!logo) {
        throw new HttpError('The selected system logo is unavailable', 400, 400)
      }
    }

    await Promise.all(changes.map((change) => tx.systemConfig.upsert({
      where: { configKey: change.key },
      update: { configValue: change.value, description: change.description, updatedAt: new Date() },
      create: {
        configKey: change.key,
        configValue: change.value,
        description: change.description,
      },
    })))
  })
  return { updated: changes.length, message: 'Configuration saved' }
}

export async function refreshAdminSettings() {
  await prisma.systemConfig.count({
    where: { configKey: { in: ADMIN_CONFIG_DEFINITIONS.map((item) => item.key) } },
  })
  return {
    message: 'Configuration is read directly from the installed database',
    timestamp: new Date().toISOString(),
  }
}
