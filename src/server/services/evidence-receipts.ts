/**
 * @file evidence-receipts.ts
 * @project SlothVault
 * @module Administrator Evidence Receipts
 * @description Reads hash-level release, contract and commission receipts for protected administrator routes.
 * @logic Validate the route kind and signature, preserve each receipt's privacy boundary, and run live verification only on request.
 * @dependencies Existing release, contract and commission evidence services
 * @index_tags admin,evidence,receipts,verification,permissions
 * @author holic512
 */
import 'server-only'
import { z } from 'zod'
import { HttpError } from '@/server/http/errors'
import { getAdminReleaseEvidenceReceipt, verifyAdminReleaseEvidence } from './release-evidence'
import { getAdminContractEvidenceReceipt, verifyAdminContractEvidence } from './contracts'
import { getAdminWorkflowEvidenceReceipt, verifyAdminWorkflowEvidence } from '@/server/commissions/evidence'

const paramsSchema = z.object({
  kind: z.enum(['release', 'contract', 'commission']),
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,128}$/),
})

export async function getAdminEvidenceReceipt(params: { kind: string; signature: string }, live = false) {
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) throw new HttpError('Evidence receipt not found', 404, 404)
  const { kind, signature } = parsed.data
  if (kind === 'release') {
    const evidence = await getAdminReleaseEvidenceReceipt(signature)
    if (!evidence) throw new HttpError('Evidence receipt not found', 404, 404)
    return { kind, evidence, verification: live ? await verifyAdminReleaseEvidence(signature) : null }
  }
  if (kind === 'contract') {
    const evidence = await getAdminContractEvidenceReceipt(signature)
    if (!evidence) throw new HttpError('Evidence receipt not found', 404, 404)
    return { kind, evidence, verification: live ? await verifyAdminContractEvidence(signature) : null }
  }
  return { kind, evidence: await getAdminWorkflowEvidenceReceipt(signature), verification: live ? await verifyAdminWorkflowEvidence(signature) : null }
}
