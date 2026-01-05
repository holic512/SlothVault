/**
 * 准备创建 Merkle Tree 的交易
 * 
 * 流程：
 * 1. 验证请求参数
 * 2. 生成树 Keypair
 * 3. 构建交易并使用树 Keypair 部分签名
 * 4. 加密私钥并创建会话
 * 5. 返回序列化交易（不含私钥）供前端钱包签名
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 * Error Handling: 10.1, 10.2, 10.3, 10.4
 */

import { Keypair, PublicKey } from '@solana/web3.js'
import { buildCreateTreeTransaction, getConnection, type SolanaNetwork } from '~~/server/utils/solana'
import { encryptPrivateKey, secretKeyToString } from '~~/server/utils/crypto'
import { createTreeSession } from '~~/server/utils/treeSession'
import {
  SolanaError,
  SolanaErrorCode,
  createSolanaHttpError,
  checkWalletBalance,
  formatLamportsToSol,
  isRpcConnectionError,
} from '~~/server/utils/solanaErrors'

interface PrepareRequest {
  name: string
  maxDepth: number
  maxBufferSize: number
  canopyDepth?: number
  payerAddress: string
  network?: 'mainnet' | 'devnet'
}

export default defineEventHandler(async (event) => {
  const body = await readBody<PrepareRequest>(event)
  const {
    name,
    maxDepth,
    maxBufferSize,
    canopyDepth = 0,
    payerAddress,
    network = 'devnet',
  } = body

  // 1. 验证请求参数
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw createError({
      statusCode: 400,
      message: '树名称不能为空',
    })
  }

  if (name.length > 128) {
    throw createError({
      statusCode: 400,
      message: '树名称不能超过 128 个字符',
    })
  }

  if (!maxDepth || typeof maxDepth !== 'number' || maxDepth < 1 || maxDepth > 30) {
    throw createError({
      statusCode: 400,
      message: 'maxDepth 必须在 1-30 之间',
    })
  }

  if (!maxBufferSize || typeof maxBufferSize !== 'number' || maxBufferSize < 1) {
    throw createError({
      statusCode: 400,
      message: 'maxBufferSize 必须大于 0',
    })
  }

  if (canopyDepth < 0 || canopyDepth > maxDepth) {
    throw createError({
      statusCode: 400,
      message: 'canopyDepth 必须在 0 到 maxDepth 之间',
    })
  }

  if (!payerAddress || typeof payerAddress !== 'string') {
    throw createError({
      statusCode: 400,
      message: '支付者地址不能为空',
    })
  }

  // 验证支付者地址格式
  let payerPubkey: PublicKey
  try {
    payerPubkey = new PublicKey(payerAddress)
  } catch {
    throw createError({
      statusCode: 400,
      message: '无效的支付者地址格式',
    })
  }

  const networkType = network as SolanaNetwork
  if (networkType !== 'mainnet' && networkType !== 'devnet') {
    throw createError({
      statusCode: 400,
      message: '网络类型必须是 mainnet 或 devnet',
    })
  }

  // 2. 生成树 Keypair（私钥在服务端生成，不传输到前端）
  const treeKeypair = Keypair.generate()

  // 3. 构建交易
  let transaction
  let rentLamports: number
  let spaceBytes: number
  let connection

  try {
    connection = getConnection(networkType)
    
    const result = await buildCreateTreeTransaction(
      connection,
      payerPubkey,
      treeKeypair,
      maxDepth,
      maxBufferSize,
      canopyDepth
    )

    transaction = result.transaction
    rentLamports = result.rentLamports
    spaceBytes = result.spaceBytes
  } catch (err: any) {
    console.error('[Solana] 构建交易失败:', err)
    
    // RPC 连接失败 (Requirement 10.1)
    if (isRpcConnectionError(err)) {
      throw createSolanaHttpError(
        new SolanaError(SolanaErrorCode.RPC_CONNECTION_FAILED, undefined, 503)
      )
    }

    throw createSolanaHttpError(
      new SolanaError(SolanaErrorCode.TRANSACTION_BUILD_FAILED, err.message, 500)
    )
  }

  // 4. 检查钱包余额 (Requirement 10.2)
  try {
    const balanceCheck = await checkWalletBalance(connection, payerAddress, rentLamports)
    
    if (!balanceCheck.sufficient) {
      const requiredSol = formatLamportsToSol(balanceCheck.required)
      const currentSol = formatLamportsToSol(balanceCheck.balance)
      const shortfallSol = formatLamportsToSol(balanceCheck.shortfall)
      
      throw createError({
        statusCode: 400,
        message: `钱包余额不足，需要约 ${requiredSol} SOL，当前余额 ${currentSol} SOL，还差 ${shortfallSol} SOL`,
        data: {
          code: SolanaErrorCode.INSUFFICIENT_BALANCE,
          required: balanceCheck.required,
          balance: balanceCheck.balance,
          shortfall: balanceCheck.shortfall,
        },
      })
    }
  } catch (err: any) {
    // 如果是我们抛出的余额不足错误，直接重新抛出
    if (err.statusCode === 400) {
      throw err
    }
    // 其他错误（如无法获取余额）只记录日志，不阻止流程
    console.warn('[Solana] 余额检查失败，继续执行:', err.message)
  }

  // 5. 使用树 Keypair 对交易进行部分签名
  try {
    transaction.partialSign(treeKeypair)
  } catch (err: any) {
    console.error('[Solana] 部分签名失败:', err)
    throw createSolanaHttpError(
      new SolanaError(SolanaErrorCode.TRANSACTION_SIGN_FAILED, err.message, 500)
    )
  }

  // 6. 加密私钥 (Requirement 10.3 - 加密失败处理)
  const secretKeyBase64 = secretKeyToString(treeKeypair.secretKey)
  let encryptedKey: string

  try {
    encryptedKey = encryptPrivateKey(secretKeyBase64)
  } catch (err: any) {
    console.error('[Solana] 私钥加密失败:', err)
    throw createSolanaHttpError(
      new SolanaError(SolanaErrorCode.ENCRYPTION_FAILED, '请检查 ENCRYPTION_KEY 配置', 500)
    )
  }

  // 7. 创建会话存储
  const sessionId = createTreeSession({
    treeKeypair,
    encryptedKey,
    name: name.trim(),
    maxDepth,
    maxBufferSize,
    canopyDepth,
    network: networkType,
    payerAddress,
    rentLamports,
  })

  // 8. 序列化交易（Base64）
  const transactionBase64 = transaction.serialize({
    requireAllSignatures: false, // 允许部分签名
    verifySignatures: false,
  }).toString('base64')

  // 计算会话过期时间（5 分钟后）
  const expiresAt = Date.now() + 5 * 60 * 1000

  console.log(`[Solana] 准备交易成功: tree=${treeKeypair.publicKey.toBase58()}, session=${sessionId.substring(0, 8)}...`)

  // 9. 返回响应（不包含私钥信息）
  return {
    code: 0,
    data: {
      transactionBase64,
      treeAddress: treeKeypair.publicKey.toBase58(),
      sessionId,
      rentLamports,
      spaceBytes,
      expiresAt,
    },
  }
})
