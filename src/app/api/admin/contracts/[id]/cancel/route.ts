/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Contract Cancellation API
 * @description Cancels a draft or pending contract while preserving its administrator audit event.
 * @logic Authenticate the acting administrator and delegate the irreversible state transition to the contract service.
 * @dependencies admin session, HTTP helpers, contracts service
 * @index_tags api,admin,contracts,cancel,audit
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { cancelAdminContract } from '@/server/services/contracts'

export const dynamic = 'force-dynamic'

export const POST = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireAdminSession(request)
  const { id } = await context.params
  return apiOk(await cancelAdminContract({
    id: parseBigIntId(id, 'contract id'),
    issuerUserId: session.User.id,
  }))
})
