/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Contract Detail API
 * @description Reads or updates one administrator-managed contract draft.
 * @logic Require an administrator, parse a bounded identifier, and keep edits inside the draft-only service invariant.
 * @dependencies zod, admin session, HTTP helpers, contracts service
 * @index_tags api,admin,contracts,detail,update
 * @author holic512
 */
import { HttpError } from '@/server/http/errors'

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

export const PUT = defineRoute<{ id: string }>(async (request) => {
  await requireAdminSession(request)
  throw new HttpError('请在委托项目中编辑模板字段并重新生成草稿', 410, 410)
})
