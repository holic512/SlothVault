/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Release Evidence List API
 * @description Lists version transaction evidence with project, network, state, signer, and signature filters.
 * @logic Require an administrator session, validate bounded query inputs, and return indexed evidence plus network summaries.
 * @dependencies admin session, HTTP route helpers, release-evidence service
 * @index_tags api,admin,evidence,list,filters
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { listReleaseEvidence } from '@/server/services/release-evidence'
import {
  NOTE_CONTENT_EVIDENCE_SUBJECT,
  PROJECT_VERSION_EVIDENCE_SUBJECT,
} from '@/server/services/note-content-evidence-protocol'

function positiveInt(value: string | null, fallback?: number) {
  if (!value) return fallback
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : fallback
}

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  const query = request.nextUrl.searchParams
  const network = query.get('network')
  const statusText = query.get('status')
  const status = statusText === null || statusText === '' ? undefined : Number(statusText)
  const subjectTypeText = query.get('subjectType')
  const subjectType = subjectTypeText === NOTE_CONTENT_EVIDENCE_SUBJECT || subjectTypeText === PROJECT_VERSION_EVIDENCE_SUBJECT
    ? subjectTypeText
    : undefined
  if (network && network !== 'mainnet' && network !== 'devnet') {
    return apiOk(await listReleaseEvidence({ page: 1, pageSize: 20, network: undefined }))
  }
  return apiOk(await listReleaseEvidence({
    projectId: positiveInt(query.get('projectId')),
    projectVersionId: positiveInt(query.get('projectVersionId')),
    subjectType,
    network: (network || undefined) as 'mainnet' | 'devnet' | undefined,
    status: Number.isInteger(status) ? status : undefined,
    signerAddress: query.get('signerAddress')?.trim() || undefined,
    transactionSignature: query.get('transactionSignature')?.trim() || undefined,
    page: Math.min(positiveInt(query.get('page'), 1)!, 100_000),
    pageSize: Math.min(positiveInt(query.get('pageSize'), 20)!, 100),
  }))
})
