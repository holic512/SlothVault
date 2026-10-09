/**
 * @file route.ts
 * @project SlothVault
 * @module Commission Workflow Route
 * @description Connects the commission workflow page or authenticated API boundary.
 * @logic Validate route inputs and delegate to the role-aware workflow service or shared page.
 * @dependencies Next.js, commission workflow modules
 * @index_tags commissions,workflow,access
 * @author holic512
 */
import { z } from 'zod'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { commissionActor } from '@/server/commissions/http'
import { prepareWorkflowEvidence, submitWorkflowEvidence, cancelWorkflowEvidence, reconcileWorkflowEvidence } from '@/server/commissions/evidence'
const id = z.number().int().positive()
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('prepare'), eventId: z.string().uuid(), network: z.enum(['devnet', 'mainnet']), signerAddress: z.string().max(64) }).strict(),
  z.object({ action: z.literal('submit'), attemptId: id, signedTransactionBase64: z.string().max(2000) }).strict(),
  z.object({ action: z.literal('cancel'), attemptId: id }).strict(),
  z.object({ action: z.literal('reconcile'), attemptId: id }).strict(),
])
export const POST = defineRoute(async (request) => {
  const actor = await commissionActor(request, true), body = await readJson(request, input)
  if (body.action === 'prepare') return apiOk(await prepareWorkflowEvidence({ ...body, issuerUserId: actor.userId }))
  if (body.action === 'submit') return apiOk(await submitWorkflowEvidence(body.attemptId, actor.userId, body.signedTransactionBase64))
  if (body.action === 'cancel') return apiOk(await cancelWorkflowEvidence(body.attemptId, actor.userId))
  return apiOk(await reconcileWorkflowEvidence(body.attemptId))
})
