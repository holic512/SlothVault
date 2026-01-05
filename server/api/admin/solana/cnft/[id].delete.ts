/**
 * 删除铸造中或失败的 cNFT 记录
 *
 * 只允许删除状态为"铸造中"(0)或"失败"(-1)的记录
 * 删除时会回滚对应树的 totalMinted 计数
 */

import { prisma } from '~~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: '缺少 cNFT ID',
    })
  }

  // 1. 查询 cNFT 记录
  const cnft = await prisma.compressedNft.findUnique({
    where: { id: BigInt(id) },
    select: {
      id: true,
      status: true,
      merkleTreeId: true,
      leafIndex: true,
      name: true,
    },
  })

  if (!cnft) {
    throw createError({
      statusCode: 404,
      message: 'cNFT 记录不存在',
    })
  }

  // 2. 检查状态，只允许删除铸造中或失败的记录
  if (cnft.status === 1) {
    throw createError({
      statusCode: 400,
      message: '无法删除已成功铸造的 cNFT',
    })
  }

  // 3. 使用事务删除记录并回滚 totalMinted
  try {
    await prisma.$transaction(async (tx) => {
      // 删除 cNFT 记录
      await tx.compressedNft.delete({
        where: { id: cnft.id },
      })

      // 回滚树的 totalMinted（只有铸造中状态才需要回滚）
      if (cnft.status === 0) {
        await tx.merkleTree.update({
          where: { id: cnft.merkleTreeId },
          data: {
            totalMinted: { decrement: 1 },
            updatedAt: new Date(),
          },
        })
      }
    })

    console.log(`[cNFT Delete] 已删除: id=${id}, name=${cnft.name}, status=${cnft.status}`)

    return {
      code: 0,
      message: '删除成功',
    }
  } catch (err: any) {
    console.error('[cNFT Delete] 删除失败:', err)
    throw createError({
      statusCode: 500,
      message: '删除失败: ' + err.message,
    })
  }
})
