/**
 * @file route.ts
 * @project SlothVault
 * @module Admin System Configuration API
 * @description Lists known settings without echoing stored secrets and atomically persists validated changes.
 * @logic Join database values with a fixed metadata registry, mask secret values, reject unknown/duplicate keys, and upsert one transaction.
 * @dependencies admin session, Prisma SystemConfig model, admin content service
 * @index_tags api,admin,settings,secrets,transaction
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'
import {
  ADMIN_CONFIG_DEFINITIONS,
  configDefinition,
  type AdminConfigKey,
  validateConfigValue,
} from '@/server/services/admin-content'

const updateConfigsSchema = z.object({
  configs: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      clear: z.boolean().optional(),
    }),
  ).min(1).max(ADMIN_CONFIG_DEFINITIONS.length),
})

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
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
  return apiOk({ configs, groups })
})

export const PUT = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, updateConfigsSchema)
  const seen = new Set<string>()
  const changes: Array<{
    key: AdminConfigKey
    value: string
    description: string
  }> = []

  for (const item of body.configs) {
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
        update: { configValue: change.value, description: change.description, updatedAt: new Date() },
        create: { configKey: change.key, configValue: change.value, description: change.description },
      }),
    ),
  )
  return apiOk({ updated: changes.length, message: 'Configuration saved' })
})
