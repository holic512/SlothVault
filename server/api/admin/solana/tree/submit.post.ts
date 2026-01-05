/**
 * 提交已签名的 Merkle Tree 创建交易
 * 
 * 流程：
 * 1. 验证会话有效性
 * 2. 反序列化并验证交易签名
 * 3. 发送交易到链上
 * 4. 等待确认并保存数据库记录
 * 5. 清理会话
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 * Error Handling: 10.1, 10.2, 10.3, 10.4
 */

import { Transaction } from '@solana/web3.js'
import { getTreeSession, deleteTreeSession } from '~~/server/utils/treeSession'
import { getConnection, type SolanaNetwork } from '~~/server/utils/solana'
import { prisma } from '~~/server/utils/prisma'
import {
  SolanaError,
  SolanaErrorCode,
  createSolanaHttpError,
  formatLamportsToSol,
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
    })
  }

  if (!signedTransactionBase64 || typeof signedTransactionBase64 !== 'string') {
    throw createError({
      statusCode: 400,
      message: '签名交易不能为空',
    })
  }

  // 2. 验证会话有效性 (Requirement 10.3 - 会话过期处理)
  const session = getTreeSession(sessionId)
  if (!session) {
    throw createSolanaHttpError(
      new SolanaError(SolanaErrorCode.SESSION_EXPIRED, undefined, 400)
    )
  }

  // 3. 反序列化交易
  let transaction: Transaction
  try {
    const transactionBuffer = Buffer.from(signedTransactionBase64, 'base64')
    transaction = Transaction.from(transactionBuffer)
  } catch (err: any) {
    console.error('[Solana] 交易反序列化失败:', err)
    throw createError({
      statusCode: 400,
      message: '无效的交易数据格式',
    })
  }

  // 4. 验证交易签名完整性 (Requirement 10.4 - 签名验证失败)
  // 检查交易是否包含所有必要的签名（树 Keypair 签名 + 支付者签名）
  const treeAddress = session.treeKeypair.publicKey.toBase58()
  
  // 验证签名数量和完整性
  if (!transaction.signatures || transaction.signatures.length < 2) {
    throw createSolanaHttpError(
      new SolanaError(SolanaErrorCode.SIGNATURE_INVALID, '需要树账户和支付者的签名', 400)
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

  // 5. 获取 RPC 连接并发送交易
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
    console.log(`[Solana] 交易已发送: ${txSignature}`)
  } catch (err: any) {
    console.error('[Solana] 交易发送失败:', err)
    
    const errorMessage = err.message || ''
    
    // 余额不足 (Requirement 10.2)
    if (isInsufficientBalanceError(err)) {
      const requiredSol = formatLamportsToSol(session.rentLamports)
      throw createError({
        statusCode: 400,
        message: `钱包余额不足，需要约 ${requiredSol} SOL`,
        data: {
          code: SolanaErrorCode.INSUFFICIENT_BALANCE,
          required: session.rentLamports,
        },
      })
    }
    
    // 交易过期
    if (isTransactionExpiredError(err)) {
      throw createSolanaHttpError(
        new SolanaError(SolanaErrorCode.TRANSACTION_EXPIRED, undefined, 400)
      )
    }

    // RPC 连接失败 (Requirement 10.1)
    if (isRpcConnectionError(err)) {
      throw createSolanaHttpError(
        new SolanaError(SolanaErrorCode.RPC_CONNECTION_FAILED, undefined, 503)
      )
    }

    throw createSolanaHttpError(
      new SolanaError(SolanaErrorCode.TRANSACTION_SEND_FAILED, errorMessage, 500)
    )
  }

  // 6. 等待交易确认（使用更可靠的确认方式）
  let status: number = 0 // 默认创建中
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
      console.error('[Solana] 交易确认失败:', confirmation.value.err)
      status = -1 // 失败
    } else {
      console.log(`[Solana] 交易已确认: ${txSignature}`)
      status = 1 // 正常
    }
  } catch (err: any) {
    // blockhash 过期，尝试直接查询交易状态
    console.log('[Solana] blockhash 过期，查询交易状态...')
    try {
      // 等待一小段时间让交易有机会被确认
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      const txStatus = await connection.getSignatureStatus(txSignature)
      if (txStatus.value?.confirmationStatus === 'confirmed' || 
          txStatus.value?.confirmationStatus === 'finalized') {
        if (txStatus.value.err) {
          console.error('[Solana] 交易执行失败:', txStatus.value.err)
          status = -1
        } else {
          console.log(`[Solana] 交易已确认（通过状态查询）: ${txSignature}`)
          status = 1
        }
      } else {
        console.log('[Solana] 交易状态未知，保存为创建中')
        status = 0
      }
    } catch (statusErr: any) {
      console.warn('[Solana] 无法查询交易状态，保存为创建中:', statusErr.message)
      status = 0
    }
  }

  // 7. 计算优先级（当前网络下最大优先级 + 1）
  const maxPriorityResult = await prisma.merkleTree.aggregate({
    where: {
      network: session.network,
      isDeleted: false,
    },
    _max: {
      priority: true,
    },
  })
  const newPriority = (maxPriorityResult._max.priority ?? 0) + 1

  // 8. 计算最大容量
  const maxCapacity = BigInt(Math.pow(2, session.maxDepth))

  // 9. 保存数据库记录
  // 根据 Requirements 6.1-6.6:
  // - 保存树地址、树权限地址、加密私钥、创建者地址
  // - 保存配置参数 maxDepth、maxBufferSize、canopyDepth
  // - 计算并保存最大容量 maxCapacity = 2^maxDepth
  // - 保存交易签名 txSignature
  // - 设置优先级 priority 为当前最大值+1
  // - 加密私钥已在 prepare 阶段完成（AES-256-GCM）
  let treeRecord
  try {
    treeRecord = await prisma.merkleTree.create({
      data: {
        name: session.name,
        treeAddress: treeAddress,
        // treeAuthority 是树的管理权限地址（独立生成的 Keypair）
        treeAuthority: session.treeAuthorityKeypair.publicKey.toBase58(),
        encryptedKey: session.encryptedKey,
        creatorAddress: session.payerAddress,
        maxDepth: session.maxDepth,
        maxBufferSize: session.maxBufferSize,
        canopyDepth: session.canopyDepth,
        network: session.network,
        totalMinted: 0,
        maxCapacity: maxCapacity,
        creationCost: BigInt(session.rentLamports),
        txSignature: txSignature,
        priority: newPriority,
        status: status,
      },
    })
    console.log(`[Solana] 树记录已保存: id=${treeRecord.id}, address=${treeAddress}, authority=${session.treeAuthorityKeypair.publicKey.toBase58()}`)
  } catch (err: any) {
    console.error('[Solana] 数据库保存失败:', err)
    
    // 如果是唯一约束冲突（树地址已存在）
    if (err.code === 'P2002') {
      throw createSolanaHttpError(
        new SolanaError(SolanaErrorCode.DUPLICATE_RECORD, undefined, 409)
      )
    }

    throw createSolanaHttpError(
      new SolanaError(SolanaErrorCode.DATABASE_ERROR, err.message, 500)
    )
  }

  // 10. 清理会话
  deleteTreeSession(sessionId)

  // 11. 返回结果
  const statusText = status === 1 ? '创建成功' : status === 0 ? '创建中，请稍后验证' : '创建失败'
  
  return {
    code: 0,
    data: {
      id: treeRecord.id.toString(),
      treeAddress: treeAddress,
      txSignature: txSignature,
      status: status,
      maxCapacity: maxCapacity.toString(),
      priority: newPriority,
    },
    message: statusText,
  }
})
