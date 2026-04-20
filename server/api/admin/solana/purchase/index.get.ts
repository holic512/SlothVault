import { defineEventHandler, getQuery, setResponseStatus } from 'h3'

import { prisma } from '~~/server/utils/prisma'
import { lamportsToSolDisplay } from '~~/server/utils/projectPurchase'
import { fail, ok } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'

export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))
  const skip = (page - 1) * pageSize

  const where: any = {}
  if (typeof query.projectId === 'string' && query.projectId) {
    where.projectId = BigInt(query.projectId)
  }
  if (typeof query.status === 'string' && query.status !== '') {
    where.status = Number(query.status)
  }
  if ((query.network === 'mainnet' || query.network === 'devnet') && typeof query.network === 'string') {
    where.network = query.network
  }
  if (typeof query.buyerWalletAddress === 'string' && query.buyerWalletAddress.trim()) {
    where.buyerWalletAddress = {
      contains: query.buyerWalletAddress.trim(),
    }
  }

  const [records, total] = await Promise.all([
    prisma.projectPurchaseRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.projectPurchaseRecord.count({ where }),
  ])

  const projectIds = [...new Set(records.map((record) => record.projectId))]
  const projects = projectIds.length
    ? await prisma.project.findMany({
        where: {
          id: { in: projectIds },
        },
        select: {
          id: true,
          projectName: true,
        },
      })
    : []

  const projectMap = new Map(projects.map((project) => [project.id.toString(), project.projectName]))

  return ok({
    list: records.map((record) => ({
      id: record.id.toString(),
      projectId: record.projectId.toString(),
      projectName: projectMap.get(record.projectId.toString()) ?? null,
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
    })),
    total,
    page,
    pageSize,
  })
})
