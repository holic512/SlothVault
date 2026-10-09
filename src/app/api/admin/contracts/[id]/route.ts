/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Contract Detail API
 * @description Reads one retained administrator-visible legacy contract.
 * @logic Require an administrator and parse a bounded identifier before exposing historical contract details.
 * @dependencies admin session, HTTP helpers, contracts service
 * @index_tags api,admin,contracts,detail,history
 * @author holic512
 */

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { getAdminContract } from '@/server/services/contracts'

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id } = await context.params
  return apiOk(await getAdminContract(parseBigIntId(id, 'contract id')))
})
