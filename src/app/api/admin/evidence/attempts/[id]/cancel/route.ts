/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Evidence Attempt Cancellation API
 * @description Records a connected-wallet refusal or cancellation as a retryable failed evidence attempt.
 * @logic Authenticate the issuing administrator, accept only an unsigned prepared attempt, and retain its reason in the audit timeline.
 * @dependencies admin session, HTTP helpers, release evidence service
 * @index_tags api,admin,evidence,wallet,cancel,retry
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId, readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { cancelReleaseEvidenceAttempt } from '@/server/services/release-evidence'

const schema = z.object({ reason: z.string().max(500).optional() })

export const POST = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireAdminSession(request)
  const { id } = await context.params
  const body = await readJson(request, schema)
  return apiOk(await cancelReleaseEvidenceAttempt({
    attemptId: parseBigIntId(id, 'attempt id'),
    issuerUserId: session.User.id,
    reason: body.reason,
  }))
})
