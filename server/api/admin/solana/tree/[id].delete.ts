/**
 * 删除 Merkle Tree 记录
 * 只允许删除状态为"创建中"(0)或"失败"(-1)的记录
 * 已成功创建的树不能删除（链上数据无法删除）
 */

import { prisma } from '~~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: '缺少树 ID',
    })
  }

  const tree = await prisma.merkleTree.findUnique({
    where: { id: BigInt(id) },
  })

  if (!tree) {
    throw createError({
      statusCode: 404,
      message: '树记录不存在',
    })
  }

  // 只允许删除创建中或失败的记录
  if (tree.status === 1) {
    throw createError({
      statusCode: 400,
      message: '已成功创建的树不能删除（链上数据无法删除）',
    })
  }

  if (tree.status === 2) {
    throw createError({
      statusCode: 400,
      message: '已满的树不能删除',
    })
  }

  // 软删除
  await prisma.merkleTree.update({
    where: { id: tree.id },
    data: {
      isDeleted: true,
      updatedAt: new Date(),
    },
  })

  return {
    code: 0,
    message: '删除成功',
  }
})
