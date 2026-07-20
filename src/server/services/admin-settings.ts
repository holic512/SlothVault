/**
 * @file admin-settings.ts
 * @project SlothVault
 * @module Admin Settings Service
 * @description Owns the supported runtime-setting registry, masked reads, validated writes, and storage refresh checks.
 * @logic Join stored rows with fixed metadata, hide secret values, reject unknown or duplicate changes, and persist accepted changes atomically.
 * @dependencies Prisma SystemConfig model, server/http/errors
 * @index_tags admin,settings,secrets,validation,transaction
 * @author holic512
 */
import 'server-only'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'

export const ADMIN_CONFIG_DEFINITIONS = [
  {
    key: 'SOLANA_RPC_URL',
    group: 'solana',
    sensitive: false,
    description: 'Solana mainnet RPC URL',
    defaultValue: '',
  },
  {
    key: 'SOLANA_DEVNET_RPC_URL',
    group: 'solana',
    sensitive: false,
    description: 'Solana devnet RPC URL',
    defaultValue: '',
  },
  {
    key: 'FILEBASE_ACCESS_KEY',
    group: 'filebase',
    sensitive: true,
    description: 'Filebase IPFS access key',
    defaultValue: '',
  },
  {
    key: 'FILEBASE_SECRET_KEY',
    group: 'filebase',
    sensitive: true,
    description: 'Filebase IPFS secret key',
    defaultValue: '',
  },
  {
    key: 'FILEBASE_BUCKET',
    group: 'filebase',
    sensitive: false,
    description: 'Filebase bucket name',
    defaultValue: '',
  },
  {
    key: 'FILEBASE_ENDPOINT',
    group: 'filebase',
    sensitive: false,
    description: 'Filebase S3 endpoint',
    defaultValue: 'https://s3.filebase.com',
  },
] as const

export type AdminConfigKey = (typeof ADMIN_CONFIG_DEFINITIONS)[number]['key']

export type AdminConfigChange = {
  key: string
  value: string
  clear?: boolean
}

function configDefinition(key: string) {
  return ADMIN_CONFIG_DEFINITIONS.find((item) => item.key === key)
}

function validateConfigValue(key: AdminConfigKey, value: string) {
  if (value.length > 500) throw new HttpError(`${key} exceeds 500 characters`, 400, 400)
  if (key.endsWith('_URL') && value) {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      throw new HttpError(`${key} must be a valid URL`, 400, 400)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new HttpError(`${key} must use HTTP(S)`, 400, 400)
    }
  }
  return value
}

export async function listAdminSettings() {
  const records = await prisma.systemConfig.findMany({
    where: { configKey: { in: ADMIN_CONFIG_DEFINITIONS.map((item) => item.key) } },
  })
  const byKey = new Map(records.map((record) => [record.configKey, record.configValue]))
  const configs = ADMIN_CONFIG_DEFINITIONS.map((definition) => {
    const storedValue = byKey.get(definition.key) || ''
    return {
      key: definition.key,
      value: definition.sensitive ? '' : storedValue,
      description: definition.description,
      defaultValue: definition.defaultValue,
      sensitive: definition.sensitive,
      configured: Boolean(storedValue),
    }
  })
  const groups = ['solana', 'filebase'].map((groupKey) => ({
    key: groupKey,
    label: groupKey,
    configs: configs.filter(
      (config) => configDefinition(config.key)?.group === groupKey,
    ),
  }))
  return { configs, groups }
}

export async function updateAdminSettings(configs: AdminConfigChange[]) {
  const seen = new Set<string>()
  const changes: Array<{
    key: AdminConfigKey
    value: string
    description: string
  }> = []

  for (const item of configs) {
    if (seen.has(item.key)) throw new HttpError(`Duplicate config key: ${item.key}`, 400, 400)
    seen.add(item.key)
    const definition = configDefinition(item.key)
    if (!definition) throw new HttpError(`Unknown config key: ${item.key}`, 400, 400)
    if (definition.sensitive && item.value === '' && item.clear !== true) continue
    changes.push({
      key: definition.key,
      value: validateConfigValue(definition.key, item.value),
      description: definition.description,
    })
  }
  if (!changes.length) throw new HttpError('No configuration changes to save', 400, 400)

  await prisma.$transaction(
    changes.map((change) =>
      prisma.systemConfig.upsert({
        where: { configKey: change.key },
        update: {
          configValue: change.value,
          description: change.description,
          updatedAt: new Date(),
        },
        create: {
          configKey: change.key,
          configValue: change.value,
          description: change.description,
        },
      }),
    ),
  )
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
