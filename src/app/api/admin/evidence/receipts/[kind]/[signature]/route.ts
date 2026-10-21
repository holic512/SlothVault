/**
 * @file route.ts
 * @project SlothVault
 * @module Administrator Evidence Receipt API
 * @description Exposes both evidence networks exclusively to active administrators.
 * @logic Authenticate before reading any receipt and prevent caching of stored and live verification responses.
 * @dependencies Administrator session, evidence receipt service, HTTP helpers
 * @index_tags api,admin,evidence,receipts,verification
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { getAdminEvidenceReceipt } from '@/server/services/evidence-receipts'

export const dynamic = 'force-dynamic'
export const GET = defineRoute<{ kind: string; signature: string }>(async (request, context) => {
  await requireAdminSession(request)
  return apiOk(await getAdminEvidenceReceipt(await context.params, request.nextUrl.searchParams.get('live') === '1'))
}, { cacheControl: 'private, no-store' })
