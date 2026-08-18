/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Contract Evidence Reconciliation API
 * @description Rechecks a submitted contract Memo transaction against finalized Solana data.
 * @logic Authenticate the administrator, record the reconciliation audit event, and return the durable credential state.
 * @dependencies admin session, HTTP helpers, contracts service
 * @index_tags api,admin,contracts,evidence,reconcile,audit
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { reconcileContractEvidence } from '@/server/services/contracts'

export const dynamic = 'force-dynamic'

export const POST = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireAdminSession(request)
  const { id } = await context.params
  return apiOk(await reconcileContractEvidence(
    parseBigIntId(id, 'credential id'),
    session.User.id,
  ))
})
