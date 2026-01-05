/**
 * 确认 cNFT 铸造结果
 * 前端完成交易后调用此 API 更新状态
 */

import { prisma } from '~~/server/utils/prisma'
import { getConnection } from '~~/server/utils/solana'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const {
    cnftId,
    assetId,
    txSignature,
    network,
  } = body

  if (!cnftId || !txSignature) {
    throw createError({
      statusCode: 400,
      message: '缺少必要参数：cnftId, txSignature',
    })
  }

  const cnft = await prisma.compressedNft.findUnique({
    where: { id: BigInt(cnftId) },
    include: { merkleTree: true },
  })

  if (!cnft) {
    throw createError({
      statusCode: 404,
      message: 'cNFT 记录不存在',
    })
  }

  // 验证交易
  const connection = getConnection((network || cnft.merkleTree.network) as 'mainnet' | 'devnet')
  
  try {
    const txInfo = await connection.getTransaction(txSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })

    if (!txInfo) {
      return {
        code: 1,
        message: '交易未找到，可能还在确认中',
      }
    }

    if (txInfo.meta?.err) {
      // 交易失败，更新状态
      await prisma.compressedNft.update({
        where: { id: cnft.id },
        data: {
          status: -1,
          mintTxSignature: txSignature,
          updatedAt: new Date(),
        },
      })

      // 回滚树的铸造计数
      await prisma.merkleTree.update({
        where: { id: cnft.merkleTreeId },
        data: { totalMinted: { decrement: 1 } },
      })

      return {
        code: -1,
        message: '铸造交易失败',
        data: { error: JSON.stringify(txInfo.meta.err) },
      }
    }

    // 交易成功，更新 cNFT 记录
    await prisma.compressedNft.update({
      where: { id: cnft.id },
      data: {
        assetId: assetId || `${cnft.merkleTree.treeAddress}_${cnft.leafIndex}`,
        mintTxSignature: txSignature,
        status: 1, // 正常
        updatedAt: new Date(),
      },
    })

    return {
      code: 0,
      message: '铸造成功',
      data: {
        cnftId: cnft.id.toString(),
        assetId: assetId || `${cnft.merkleTree.treeAddress}_${cnft.leafIndex}`,
        txSignature,
      },
    }
  } catch (err: any) {
    console.error('验证交易失败:', err)
    return {
      code: 1,
      message: '验证交易失败，请稍后重试',
      data: { error: err.message },
    }
  }
})
