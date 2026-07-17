import { z } from 'zod'

import { verifyWalletProof } from '@/server/auth/wallet-proof'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId, readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { verifyProjectAccess } from '@/server/services/project-access'

const bodySchema = z.object({
  walletAddress: z.string().optional(),
  signature: z.string().optional(),
  timestamp: z.number().int().safe().optional(),
  forceChainVerify: z.boolean().optional().default(false),
})

export const POST = defineRoute<{ id: string }>(async (request, context) => {
  const { id } = await context.params
  const projectId = parseBigIntId(id, 'project id')
  const body = await readJson(request, bodySchema)

  const initial = await verifyProjectAccess(projectId, null)
  if (!initial.requireAuth) return apiOk(initial)
  if (!body.walletAddress || !body.signature || !body.timestamp) return apiOk(initial)

  const walletAddress = verifyWalletProof(projectId, {
    address: body.walletAddress,
    signature: body.signature,
    timestamp: body.timestamp,
  })
  return apiOk(
    await verifyProjectAccess(projectId, walletAddress, {
      forceChainVerify: body.forceChainVerify,
    }),
  )
})
