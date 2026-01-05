/**
 * 提交已签名的 cNFT 铸造交易
 *
 * 流程：
 * 1. 验证会话有效性
 * 2. 反序列化并验证交易签名完整性
 * 3. 发送交易到 Solana 网络
 * 4. 等待交易确认
 * 5. 计算并更新 assetId
 * 6. 更新 cNFT 记录状态和交易签名
 * 7. 处理失败情况（回滚 totalMinted）
 * 8. 清理会话
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.4, 6.5, 6.6
 */

import { PublicKey, Transaction } from '@solana/web3.js'
import { getMintSession, deleteMintSession } from '~~/server/utils/mintSession'
import { getConnection, type SolanaNetwork } from '~~/server/utils/solana'
import { prisma } from '~~/server/utils/prisma'
import { getAssetId } from '~~/server/utils/bubblegum'
import {
  SolanaError,
  SolanaErrorCode,
  createSolanaHttpError,
  isRpcConnectionError,
  isInsufficientBalanceError,
  isTransactionExpiredError,
} from '~~/server/utils/solanaErrors'

interface SubmitRequest {
  sessionId: string
  signedTransactionBase64: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<SubmitRequest>(event)
  const { sessionId, signedTransactionBase64 } = body

  // 1. 验证请求参数
  if (!sessionId || typeof sessionId !== 'string') {
    throw createError({
      statusCode: 400,
      message: '会话 ID 不能为空',
      data: { code: SolanaErrorCode.INVALID_PARAMS },
    })
  }

  if (!signedTransactionBase64 || typeof signedTransactionBase64 !== 'string') {
    throw createError({
      statusCode: 400,
      message: '签名交易不能为空',
      data: { code: SolanaErrorCode.INVALID_PARAMS },
    })
  }

  // 2. 验证会话有效性 (Requirement 5.1)
  const session = getMintSession(sessionId)
  if (!session) {
    throw createSolanaHttpError(
      new SolanaError(SolanaErrorCode.SESSION_EXPIRED, '铸造会话已过期，请重新发起铸造', 400)
    )
  }

  // 3. 反序列化交易
  let transaction: Transaction
  try {
    const transactionBuffer = Buffer.from(signedTransactionBase64, 'base64')
    transaction = Transaction.from(transactionBuffer)
  } catch (err: any) {
    console.error('[cNFT Submit] 交易反序列化失败:', err)
    throw createError({
      statusCode: 400,
      message: '无效的交易数据格式',
      data: { code: SolanaErrorCode.INVALID_PARAMS },
    })
  }

  // 4. 验证交易签名完整性 (Requirement 5.2)
  // 检查交易是否包含所有必要的签名（树权限签名 + 支付者签名）
  if (!transaction.signatures || transaction.signatures.length < 2) {
    throw createSolanaHttpError(
      new SolanaError(SolanaErrorCode.SIGNATURE_INVALID, '需要树权限和支付者的签名', 400)
    )
  }

  // 验证所有签名都已填充（非空）
  const hasAllSignatures = transaction.signatures.every(
    sig => sig.signature !== null && sig.signature.length > 0
  )
  if (!hasAllSignatures) {
    throw createSolanaHttpError(
      new SolanaError(SolanaErrorCode.SIGNATURE_INVALID, '部分签名缺失', 400)
    )
  }

  // 5. 获取 RPC 连接并发送交易 (Requirement 5.3)
  const network = session.network as SolanaNetwork
  const connection = getConnection(network)

  let txSignature: string
  try {
    // 发送原始交易（已完全签名）
    txSignature = await connection.sendRawTransaction(
      transaction.serialize(),
      {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      }
    )
    console.log(`[cNFT Submit] 交易已发送: ${txSignature}`)
  } catch (err: any) {
    console.error('[cNFT Submit] 交易发送失败:', err)

    const errorMessage = err.message || ''

    // 余额不足
    if (isInsufficientBalanceError(err)) {
      throw createError({
        statusCode: 400,
        message: '钱包余额不足，请确保有足够的 SOL 支付交易费',
        data: { code: SolanaErrorCode.INSUFFICIENT_BALANCE },
      })
    }

    // 交易过期
    if (isTransactionExpiredError(err)) {
      // 清理会话
      deleteMintSession(sessionId)
      throw createSolanaHttpError(
        new SolanaError(SolanaErrorCode.TRANSACTION_EXPIRED, '交易已过期，请重新发起铸造', 400)
      )
    }

    // RPC 连接失败
    if (isRpcConnectionError(err)) {
      throw createSolanaHttpError(
        new SolanaError(SolanaErrorCode.RPC_CONNECTION_FAILED, undefined, 503)
      )
    }

    throw createSolanaHttpError(
      new SolanaError(SolanaErrorCode.TRANSACTION_SEND_FAILED, errorMessage, 500)
    )
  }

  // 6. 等待交易确认 (Requirement 5.4)
  let confirmationStatus: 'success' | 'failed' | 'pending' = 'pending'
  try {
    // 先尝试使用 blockhash 确认（更快）
    const confirmation = await connection.confirmTransaction(
      {
        signature: txSignature,
        blockhash: transaction.recentBlockhash!,
        lastValidBlockHeight: transaction.lastValidBlockHeight!,
      },
      'confirmed'
    )

    if (confirmation.value.err) {
      console.error('[cNFT Submit] 交易确认失败:', confirmation.value.err)
      confirmationStatus = 'failed'
    } else {
      console.log(`[cNFT Submit] 交易已确认: ${txSignature}`)
      confirmationStatus = 'success'
    }
  } catch (err: any) {
    // blockhash 过期，尝试直接查询交易状态
    console.log('[cNFT Submit] blockhash 过期，查询交易状态...')
    try {
      // 等待一小段时间让交易有机会被确认
      await new Promise(resolve => setTimeout(resolve, 2000))

      const txStatus = await connection.getSignatureStatus(txSignature)
      if (txStatus.value?.confirmationStatus === 'confirmed' ||
          txStatus.value?.confirmationStatus === 'finalized') {
        if (txStatus.value.err) {
          console.error('[cNFT Submit] 交易执行失败:', txStatus.value.err)
          confirmationStatus = 'failed'
        } else {
          console.log(`[cNFT Submit] 交易已确认（通过状态查询）: ${txSignature}`)
          confirmationStatus = 'success'
        }
      } else {
        console.log('[cNFT Submit] 交易状态未知，保存为铸造中')
        confirmationStatus = 'pending'
      }
    } catch (statusErr: any) {
      console.warn('[cNFT Submit] 无法查询交易状态，保存为铸造中:', statusErr.message)
      confirmationStatus = 'pending'
    }
  }

  // 7. 计算 Asset ID (Requirement 6.4)
  const merkleTreePubkey = new PublicKey(session.merkleTreeAddress)
  const [assetIdPubkey] = getAssetId(merkleTreePubkey, session.leafIndex)
  const assetId = assetIdPubkey.toBase58()

  // 8. 根据确认状态更新数据库 (Requirement 5.5, 5.6, 6.5, 6.6)
  if (confirmationStatus === 'success') {
    // 交易成功，更新 cNFT 记录状态为正常
    try {
      // 先检查是否存在相同 assetId 的旧记录（可能是之前失败的）
      const existingRecord = await prisma.compressedNft.findUnique({
        where: { assetId: assetId },
        select: { id: true, status: true },
      })

      // 如果存在旧记录且不是当前记录，需要处理冲突
      if (existingRecord && existingRecord.id !== session.cnftId) {
        if (existingRecord.status !== 1) {
          // 旧记录是失败或铸造中状态，删除它
          console.log(`[cNFT Submit] 删除冲突的旧记录: id=${existingRecord.id}, assetId=${assetId}`)
          await prisma.compressedNft.delete({
            where: { id: existingRecord.id },
          })
        } else {
          // 旧记录是成功状态，说明这个 assetId 已经被使用，当前记录标记为失败
          console.error(`[cNFT Submit] assetId 已被占用: ${assetId}`)
          await prisma.compressedNft.update({
            where: { id: session.cnftId },
            data: {
              mintTxSignature: txSignature,
              status: -1,
              updatedAt: new Date(),
            },
          })
          deleteMintSession(sessionId)
          return {
            code: -1,
            data: {
              cnftId: session.cnftId.toString(),
              txSignature: txSignature,
              status: -1,
            },
            message: 'assetId 冲突，该叶子索引已被占用',
          }
        }
      }

      // 更新当前记录
      await prisma.compressedNft.update({
        where: { id: session.cnftId },
        data: {
          assetId: assetId,
          mintTxSignature: txSignature,
          status: 1, // 正常
          updatedAt: new Date(),
        },
      })
      console.log(`[cNFT Submit] cNFT 记录已更新: id=${session.cnftId}, assetId=${assetId}`)
    } catch (err: any) {
      console.error('[cNFT Submit] 更新 cNFT 记录失败:', err.message)
      // 即使数据库更新失败，交易已经成功，返回成功但带警告
    }

    // 清理会话
    deleteMintSession(sessionId)

    return {
      code: 0,
      data: {
        cnftId: session.cnftId.toString(),
        assetId: assetId,
        txSignature: txSignature,
        status: 1,
        leafIndex: session.leafIndex,
      },
      message: '铸造成功',
    }
  } else if (confirmationStatus === 'failed') {
    // 交易失败，更新状态并回滚 totalMinted (Requirement 5.6, 6.6)
    try {
      await prisma.$transaction([
        // 更新 cNFT 状态为失败
        prisma.compressedNft.update({
          where: { id: session.cnftId },
          data: {
            mintTxSignature: txSignature,
            status: -1, // 失败
            updatedAt: new Date(),
          },
        }),
        // 回滚树的 totalMinted 计数
        prisma.merkleTree.update({
          where: { id: session.merkleTreeId },
          data: {
            totalMinted: { decrement: 1 },
            updatedAt: new Date(),
          },
        }),
      ])
      console.log(`[cNFT Submit] 铸造失败，已回滚: cnftId=${session.cnftId}, treeId=${session.merkleTreeId}`)
    } catch (err: any) {
      console.error('[cNFT Submit] 回滚失败:', err)
    }

    // 清理会话
    deleteMintSession(sessionId)

    return {
      code: -1,
      data: {
        cnftId: session.cnftId.toString(),
        txSignature: txSignature,
        status: -1,
        leafIndex: session.leafIndex,
      },
      message: '铸造交易失败',
    }
  } else {
    // 状态未知（pending），保持铸造中状态，更新交易签名
    try {
      await prisma.compressedNft.update({
        where: { id: session.cnftId },
        data: {
          assetId: assetId,
          mintTxSignature: txSignature,
          updatedAt: new Date(),
        },
      })
    } catch (err: any) {
      console.error('[cNFT Submit] 更新交易签名失败:', err)
    }

    // 清理会话
    deleteMintSession(sessionId)

    return {
      code: 1,
      data: {
        cnftId: session.cnftId.toString(),
        assetId: assetId,
        txSignature: txSignature,
        status: 0,
        leafIndex: session.leafIndex,
      },
      message: '交易已提交，等待确认中',
    }
  }
})
