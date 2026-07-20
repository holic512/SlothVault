/**
 * @file route.ts
 * @project SlothVault
 * @module Admin System Configuration API
 * @description Exposes masked runtime settings and accepts validated setting changes.
 * @logic Authenticate, parse the request, delegate settings reads or writes, and wrap the stable API response.
 * @dependencies admin session, server/http helpers, admin settings service
 * @index_tags api,admin,settings,secrets,transaction
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import {
  ADMIN_CONFIG_DEFINITIONS,
  listAdminSettings,
  updateAdminSettings,
} from '@/server/services/admin-settings'

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
  return apiOk(await listAdminSettings())
})

export const PUT = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, updateConfigsSchema)
  return apiOk(await updateAdminSettings(body.configs))
})
