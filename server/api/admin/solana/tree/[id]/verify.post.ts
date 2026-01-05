/**
 * 验证 Merkle Tree 链上状态
 * 用于验证创建中的树是否已成功上链
 */

import { prisma } from '~~/server/utils/prisma'
import { getConnection } from '~~/server/utils/solana'
import { PublicKey } from '@solana/web3.js'

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
      message: '树不存在',
    })
  }

  // 如果已经是正常状态，直接返回
  if (tree.status === 1) {
    return {
      code: 0,
      data: { status: 1, message: '树状态正常' },
    }
  }

  const connection = getConnection(tree.network as 'mainnet' | 'devnet')

  // 验证方式1：检查交易签名
  if (tree.txSignature) {
    try {
      const txInfo = await connection.getTransaction(tree.txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      })

      if (txInfo && !txInfo.meta?.err) {
        // 交易成功，更新状态
        await prisma.merkleTree.update({
          where: { id: tree.id },
          data: { status: 1, updatedAt: new Date() },
        })
        return {
          code: 0,
          data: { status: 1, message: '验证成功，树已上链' },
        }
      } else if (txInfo?.meta?.err) {
        // 交易失败
        await prisma.merkleTree.update({
          where: { id: tree.id },
          data: { status: -1, updatedAt: new Date() },
        })
        return {
          code: 0,
          data: { status: -1, message: '交易失败' },
        }
      }
    } catch (err) {
      console.warn('验证交易失败:', err)
    }
  }

  // 验证方式2：检查账户是否存在
  try {
    const treePublicKey = new PublicKey(tree.treeAddress)
    const accountInfo = await connection.getAccountInfo(treePublicKey)

    if (accountInfo && accountInfo.data.length > 0) {
      // 账户存在，更新状态
      await prisma.merkleTree.update({
        where: { id: tree.id },
        data: { status: 1, updatedAt: new Date() },
      })
      return {
        code: 0,
        data: { status: 1, message: '验证成功，树账户已存在' },
      }
    }
  } catch (err) {
    console.warn('检查账户失败:', err)
  }

  return {
    code: 0,
    data: { status: tree.status, message: '等待链上确认' },
  }
})
