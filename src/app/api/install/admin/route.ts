/**
 * @file route.ts
 * @project SlothVault
 * @module Installation API
 * @description Creates the sole first administrator and closes the public installer.
 * @logic Validate credentials, serialize concurrent first visitors, create the administrator and INSTALLED marker in one serializable transaction, then seal local configuration as immutable.
 * @dependencies zod, database/installer, server/http
 * @index_tags api,installer,administrator,transaction
 * @author holic512
 */
import { z } from 'zod'

import { createFirstAdministrator } from '@/server/database/installer'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'

const administratorSchema = z.object({
  username: z.string().trim().min(2).max(64),
  password: z.string().min(8).max(256),
})

export const POST = defineRoute(async (request) => {
  const body = await readJson(request, administratorSchema)
  return apiOk(await createFirstAdministrator(body), 'System installed', 201)
})
