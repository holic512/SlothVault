/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Contract Issuance API
 * @description Freezes a draft and makes it available to its designated user for Web2 signing.
 * @logic Authenticate the acting administrator, preserve their audit identity, and enforce the draft-only issuance rule.
 * @dependencies admin session, HTTP helpers, contracts service
 * @index_tags api,admin,contracts,issue,freeze,audit
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { issueAdminContract } from '@/server/services/contracts'

export const dynamic = 'force-dynamic'

export const POST = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireAdminSession(request)
  const { id } = await context.params
  return apiOk(await issueAdminContract({
    id: parseBigIntId(id, 'contract id'),
    issuerUserId: session.User.id,
  }))
})
