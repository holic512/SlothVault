/**
 * 获取 cNFT 列表
 * 支持按项目、树、持有者筛选
 */

import { prisma } from '~~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const {
    projectId,
    merkleTreeId,
    ownerAddress,
    status,
    page = '1',
    pageSize = '20',
  } = query

  const where: any = {}

  if (projectId) {
    where.projectId = BigInt(projectId as string)
  }

  if (merkleTreeId) {
    where.merkleTreeId = BigInt(merkleTreeId as string)
  }

  if (ownerAddress) {
    where.ownerAddress = ownerAddress as string
  }

  if (status !== undefined) {
    where.status = Number(status)
  }

  const skip = (Number(page) - 1) * Number(pageSize)
  const take = Number(pageSize)

  const [cnfts, total] = await Promise.all([
    prisma.compressedNft.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        merkleTree: {
          select: {
            name: true,
            treeAddress: true,
            network: true,
          },
        },
      },
    }),
    prisma.compressedNft.count({ where }),
  ])

  return {
    code: 0,
    data: {
      list: cnfts.map((cnft) => ({
        id: cnft.id.toString(),
        projectId: cnft.projectId.toString(),
        assetId: cnft.assetId,
        leafIndex: cnft.leafIndex,
        name: cnft.name,
        symbol: cnft.symbol,
        metadataUri: cnft.metadataUri,
        ownerAddress: cnft.ownerAddress,
        mintTxSignature: cnft.mintTxSignature,
        status: cnft.status,
        createdAt: cnft.createdAt,
        merkleTree: cnft.merkleTree,
      })),
      total,
      page: Number(page),
      pageSize: Number(pageSize),
    },
  }
})
