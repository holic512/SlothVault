/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Release Evidence Reconcile API
 * @description Rechecks one uncertain or failed version transaction evidence record against Solana.
 * @logic Require an administrator, parse the credential ID, and return its latest durable state.
 * @dependencies admin session, HTTP helpers, release-evidence service
 * @index_tags api,admin,evidence,reconcile
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { reconcileReleaseEvidence } from '@/server/services/release-evidence'

export const dynamic = 'force-dynamic'

export const POST = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id } = await context.params
  return apiOk(await reconcileReleaseEvidence(parseBigIntId(id, 'credential id')))
})
