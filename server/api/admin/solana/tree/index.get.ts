import { prisma } from '~~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const network = (query.network as string) || undefined

  const trees = await prisma.merkleTree.findMany({
    where: {
      isDeleted: false,
      ...(network ? { network } : {}),
    },
    orderBy: [
      { priority: 'desc' },
      { createdAt: 'desc' },
    ],
    select: {
      id: true,
      name: true,
      treeAddress: true,
      treeAuthority: true,
      creatorAddress: true,
      maxDepth: true,
      maxBufferSize: true,
      canopyDepth: true,
      network: true,
      totalMinted: true,
      maxCapacity: true,
      creationCost: true,
      txSignature: true,
      priority: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      // 注意：不选择 encryptedKey
      _count: {
        select: { cnfts: true },
      },
    },
  })

  return {
    code: 0,
    data: trees.map((tree) => ({
      ...tree,
      id: tree.id.toString(),
      maxCapacity: tree.maxCapacity.toString(),
      creationCost: tree.creationCost.toString(),
      mintedCount: tree._count.cnfts,
    })),
  }
})
