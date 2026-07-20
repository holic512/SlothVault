/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Authentication API
 * @description Accepts the legacy first-administrator initialization request.
 * @logic Validate the JSON payload, delegate serialized account creation to the authentication service, and preserve the created response contract.
 * @dependencies zod, server/http helpers, admin authentication service
 * @index_tags api,admin,authentication,initialization
 * @author holic512
 */
import { z } from 'zod'

import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { initializeAdmin } from '@/server/services/admin-auth'

const initSchema = z.object({
  username: z.string().trim().min(2).max(64),
  password: z.string().min(8).max(256),
})

export const POST = defineRoute(async (request) => {
  const body = await readJson(request, initSchema)
  const user = await initializeAdmin(body)
  return apiOk(user, 'created', 201)
})
