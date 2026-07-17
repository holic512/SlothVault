/**
 * @file route.ts
 * @project SlothVault
 * @module Admin System Configuration API
 * @description Verifies configuration storage availability for the process-independent Next.js runtime.
 * @logic Authenticate and read the known configuration rows; no in-process cache needs invalidation in the migrated architecture.
 * @dependencies admin session, Prisma SystemConfig model, admin content service
 * @index_tags api,admin,settings,refresh,database
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'
import { ADMIN_CONFIG_DEFINITIONS } from '@/server/services/admin-content'

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  await prisma.systemConfig.count({
    where: { configKey: { in: ADMIN_CONFIG_DEFINITIONS.map((item) => item.key) } },
  })
  return apiOk({
    message: 'Configuration is read directly from PostgreSQL',
    timestamp: new Date().toISOString(),
  })
})
