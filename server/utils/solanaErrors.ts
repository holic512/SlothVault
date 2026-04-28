/**
 * Solana 相关错误码和错误处理工具
 * 
 * 统一定义错误码和友好的错误消息
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */

/**
 * Solana 错误码枚举
 */
export enum SolanaErrorCode {
  // 连接错误
  RPC_CONNECTION_FAILED = 'RPC_CONNECTION_FAILED',
  RPC_TIMEOUT = 'RPC_TIMEOUT',
  
  // 余额错误
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  
  // 交易错误
  TRANSACTION_BUILD_FAILED = 'TRANSACTION_BUILD_FAILED',
  TRANSACTION_SIGN_FAILED = 'TRANSACTION_SIGN_FAILED',
  TRANSACTION_SEND_FAILED = 'TRANSACTION_SEND_FAILED',
  TRANSACTION_CONFIRM_FAILED = 'TRANSACTION_CONFIRM_FAILED',
  TRANSACTION_EXPIRED = 'TRANSACTION_EXPIRED',
  SIGNATURE_INVALID = 'SIGNATURE_INVALID',
  
  // 会话错误
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  
  // 参数错误
  INVALID_PARAMS = 'INVALID_PARAMS',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  
  // 数据库错误
  DATABASE_ERROR = 'DATABASE_ERROR',
  DUPLICATE_RECORD = 'DUPLICATE_RECORD',
  
  // 加密错误
  ENCRYPTION_FAILED = 'ENCRYPTION_FAILED',
  
  // 未知错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * 错误消息映射
 */
const ERROR_MESSAGES: Record<SolanaErrorCode, string> = {
  [SolanaErrorCode.RPC_CONNECTION_FAILED]: '网络连接失败，请稍后重试',
  [SolanaErrorCode.RPC_TIMEOUT]: '网络请求超时，请稍后重试',
  [SolanaErrorCode.INSUFFICIENT_BALANCE]: '钱包余额不足',
  [SolanaErrorCode.TRANSACTION_BUILD_FAILED]: '交易构建失败',
  [SolanaErrorCode.TRANSACTION_SIGN_FAILED]: '交易签名失败',
  [SolanaErrorCode.TRANSACTION_SEND_FAILED]: '交易发送失败',
  [SolanaErrorCode.TRANSACTION_CONFIRM_FAILED]: '交易确认失败',
  [SolanaErrorCode.TRANSACTION_EXPIRED]: '交易已过期，请重新发起',
  [SolanaErrorCode.SIGNATURE_INVALID]: '交易签名无效',
  [SolanaErrorCode.SESSION_EXPIRED]: '会话已过期，请重新发起创建请求',
  [SolanaErrorCode.SESSION_NOT_FOUND]: '会话不存在，请重新发起创建请求',
  [SolanaErrorCode.INVALID_PARAMS]: '参数无效',
  [SolanaErrorCode.INVALID_ADDRESS]: '无效的钱包地址格式',
  [SolanaErrorCode.DATABASE_ERROR]: '数据保存失败，请稍后重试',
  [SolanaErrorCode.DUPLICATE_RECORD]: '记录已存在，可能是重复提交',
  [SolanaErrorCode.ENCRYPTION_FAILED]: '加密失败，请检查系统配置',
  [SolanaErrorCode.UNKNOWN_ERROR]: '未知错误，请稍后重试',
}

/**
 * Solana 错误类
 */
export class SolanaError extends Error {
  code: SolanaErrorCode
  statusCode: number
  details?: string

  constructor(
    code: SolanaErrorCode,
    details?: string,
    statusCode: number = 500
  ) {
    const baseMessage = ERROR_MESSAGES[code] || ERROR_MESSAGES[SolanaErrorCode.UNKNOWN_ERROR]
    const message = details ? `${baseMessage}：${details}` : baseMessage
    super(message)
    this.name = 'SolanaError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }
}

/**
 * 判断是否为 RPC 连接错误
 */
export function isRpcConnectionError(error: any): boolean {
  const message = error?.message?.toLowerCase() || ''
  return (
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('etimedout') ||
    message.includes('socket') ||
    message.includes('connection')
  )
}

/**
 * 判断是否为余额不足错误
 */
export function isInsufficientBalanceError(error: any): boolean {
  const message = error?.message?.toLowerCase() || ''
  return (
    message.includes('insufficient funds') ||
    message.includes('insufficient') ||
    message.includes('not enough') ||
    message.includes('balance')
  )
}

/**
 * 判断是否为交易过期错误
 */
export function isTransactionExpiredError(error: any): boolean {
  const message = error?.message?.toLowerCase() || ''
  return (
    message.includes('blockhash') ||
    message.includes('expired') ||
    message.includes('block height exceeded')
  )
}

/**
 * 判断是否为超时错误
 */
export function isTimeoutError(error: any): boolean {
  const message = error?.message?.toLowerCase() || ''
  return (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('etimedout')
  )
}

/**
 * 解析错误并返回 SolanaError
 */
export function parseSolanaError(error: any, context?: string): SolanaError {
  // 如果已经是 SolanaError，直接返回
  if (error instanceof SolanaError) {
    return error
  }

  const message = error?.message || ''

  // RPC 连接错误
  if (isRpcConnectionError(error)) {
    return new SolanaError(SolanaErrorCode.RPC_CONNECTION_FAILED, undefined, 503)
  }

  // 超时错误
  if (isTimeoutError(error)) {
    return new SolanaError(SolanaErrorCode.RPC_TIMEOUT, undefined, 504)
  }

  // 余额不足
  if (isInsufficientBalanceError(error)) {
    return new SolanaError(SolanaErrorCode.INSUFFICIENT_BALANCE, undefined, 400)
  }

  // 交易过期
  if (isTransactionExpiredError(error)) {
    return new SolanaError(SolanaErrorCode.TRANSACTION_EXPIRED, undefined, 400)
  }

  // 默认返回未知错误，附带原始消息
  const details = context ? `${context}: ${message}` : message
  return new SolanaError(SolanaErrorCode.UNKNOWN_ERROR, details, 500)
}

/**
 * 创建 HTTP 错误响应
 */
export function createSolanaHttpError(error: SolanaError) {
  return createError({
    statusCode: error.statusCode,
    message: error.message,
    data: {
      code: error.code,
      details: error.details,
    },
  })
}

/**
 * 检查钱包余额是否足够
 * 
 * @param connection - Solana 连接
 * @param walletAddress - 钱包地址
 * @param requiredLamports - 所需 lamports（包含租金和交易费）
 * @returns 余额检查结果
 */
export async function checkWalletBalance(
  connection: any,
  walletAddress: string,
  requiredLamports: number
): Promise<{ sufficient: boolean; balance: number; required: number; shortfall: number }> {
  try {
    const { PublicKey } = await import('@solana/web3.js')
    const pubkey = new PublicKey(walletAddress)
    const balance = await connection.getBalance(pubkey)
    
    // 添加一些余量用于交易费（约 0.00001 SOL = 10000 lamports）
    const totalRequired = requiredLamports + 10000
    
    return {
      sufficient: balance >= totalRequired,
      balance,
      required: totalRequired,
      shortfall: Math.max(0, totalRequired - balance),
    }
  } catch (error) {
    // 如果无法获取余额，假设足够（让交易发送时再检查）
    console.warn('无法检查钱包余额:', error)
    return {
      sufficient: true,
      balance: 0,
      required: requiredLamports,
      shortfall: 0,
    }
  }
}

/**
 * 格式化 lamports 为 SOL 字符串
 */
export function formatLamportsToSol(lamports: number): string {
  return (lamports / 1_000_000_000).toFixed(4)
}
