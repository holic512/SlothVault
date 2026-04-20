import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'

import { prisma } from '~~/server/utils/prisma'
import { expirePreparedPurchaseIfNeeded } from '~~/server/utils/projectPurchaseLifecycle'
import { lamportsToSolDisplay } from '~~/server/utils/projectPurchase'
import { fail, ok } from '~~/server/utils/response'

function purchaseRecordToDto(record: any) {
  return {
    id: record.id.toString(),
    projectId: record.projectId.toString(),
    buyerWalletAddress: record.buyerWalletAddress,
    receiverWalletAddress: record.receiverWalletAddress,
    network: record.network,
    priceLamports: record.priceLamports.toString(),
    priceSol: lamportsToSolDisplay(record.priceLamports),
    txSignature: record.txSignature,
    cnftId: record.cnftId?.toString() ?? null,
    assetId: record.assetId,
    status: record.status,
    failureReason: record.failureReason,
    confirmedAt: record.confirmedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export default defineEventHandler(async (event) => {
  const projectIdRaw = getRouterParam(event, 'id')
  const purchaseIdRaw = getRouterParam(event, 'purchaseId')

  if (!projectIdRaw || !purchaseIdRaw) {
    setResponseStatus(event, 400)
    return fail('Missing purchase parameters', 400)
  }

  let projectId: bigint
  let purchaseId: bigint
  try {
    projectId = BigInt(projectIdRaw)
    purchaseId = BigInt(purchaseIdRaw)
  } catch {
    setResponseStatus(event, 400)
    return fail('Invalid purchase parameters', 400)
  }

  await expirePreparedPurchaseIfNeeded(purchaseId)

  const record = await prisma.projectPurchaseRecord.findFirst({
    where: {
      id: purchaseId,
      projectId,
    },
  })

  if (!record) {
    setResponseStatus(event, 404)
    return fail('Purchase record not found', 404)
  }

  return ok(purchaseRecordToDto(record))
})
