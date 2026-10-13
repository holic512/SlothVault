/**
 * @file route.ts
 * @project SlothVault
 * @module Deleted Account History API
 * @description Lists independent credential-free account deletion records.
 * @logic Require active administrator access and validate bounded history filters before reading audit summaries.
 * @dependencies zod, admin session, admin-users service
 * @index_tags api,users,deletion,audit,history
 * @author holic512
 */
import { z } from 'zod'
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { listDeletedUsers } from '@/server/services/admin-users'
const filters = z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), keyword: z.string().trim().max(255).optional() })
export const GET = defineRoute(async request => {
  await requireAdminSession(request)
  return apiOk(await listDeletedUsers(filters.parse(Object.fromEntries(request.nextUrl.searchParams))))
})
