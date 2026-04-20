import { prisma } from './prisma'
import { PurchaseStatus } from './projectPurchase'

const PURCHASE_SESSION_EXPIRY_MS = 5 * 60 * 1000

export async function expirePreparedPurchaseIfNeeded(recordId: bigint): Promise<void> {
  const record = await prisma.projectPurchaseRecord.findUnique({
    where: { id: recordId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      cnftId: true,
    },
  })

  if (!record || record.status !== PurchaseStatus.PREPARED) {
    return
  }

  if (Date.now() - record.createdAt.getTime() < PURCHASE_SESSION_EXPIRY_MS) {
    return
  }

  const cnft = record.cnftId
    ? await prisma.compressedNft.findUnique({
        where: { id: record.cnftId },
        select: {
          id: true,
          status: true,
          merkleTreeId: true,
        },
      })
    : null

  await prisma.$transaction(async (tx) => {
    await tx.projectPurchaseRecord.update({
      where: { id: record.id },
      data: {
        status: PurchaseStatus.EXPIRED_OR_CANCELLED,
        failureReason: '购买会话已过期',
        updatedAt: new Date(),
      },
    })

    if (cnft && cnft.status === 0) {
      await tx.compressedNft.update({
        where: { id: cnft.id },
        data: {
          status: -1,
          updatedAt: new Date(),
        },
      })

      await tx.merkleTree.update({
        where: { id: cnft.merkleTreeId },
        data: {
          totalMinted: { decrement: 1 },
          updatedAt: new Date(),
        },
      })
    }
  })
}
