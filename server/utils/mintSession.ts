/**
 * 铸造会话管理模块
 *
 * 用于临时存储 cNFT 铸造过程中的会话数据，包括：
 * - 树权限 Keypair（用于交易签名）
 * - Merkle Tree 信息
 * - cNFT 记录信息
 *
 * 会话在 5 分钟后自动过期，防止内存泄漏
 *
 * Requirements: 3.5, 5.1
 */

import { randomBytes } from 'node:crypto'
import type { Keypair } from '@solana/web3.js'

// 会话过期时间（毫秒）- 5 分钟
const SESSION_EXPIRY_MS = 5 * 60 * 1000

// 清理间隔（毫秒）- 1 分钟
const CLEANUP_INTERVAL_MS = 60 * 1000

/**
 * 铸造会话数据结构
 */
export interface MintSession {
  /** 树权限 Keypair（从数据库解密） */
  treeAuthorityKeypair: Keypair
  /** Merkle Tree ID */
  merkleTreeId: bigint
  /** Merkle Tree 地址 */
  merkleTreeAddress: string
  /** 预创建的 cNFT 记录 ID */
  cnftId: bigint
  /** 叶子索引 */
  leafIndex: number
  /** 支付者地址 */
  payerAddress: string
  /** 网络类型 */
  network: string
  /** 会话创建时间戳 */
  createdAt: number
  /** 会话过期时间戳 */
  expiresAt: number
}

/**
 * 创建会话时的输入数据（不包含时间戳）
 */
export type CreateMintSessionInput = Omit<MintSession, 'createdAt' | 'expiresAt'>

// 内存会话存储
const sessionStore = new Map<string, MintSession>()

// 清理定时器引用
let cleanupTimer: ReturnType<typeof setInterval> | null = null

/**
 * 生成唯一的会话 ID
 * 使用 32 字节随机数，转换为 hex 字符串
 */
function generateSessionId(): string {
  return randomBytes(32).toString('hex')
}

/**
 * 创建新的铸造会话
 *
 * @param data - 会话数据（不包含时间戳）
 * @returns 会话 ID
 */
export function createMintSession(data: CreateMintSessionInput): string {
  const sessionId = generateSessionId()
  const now = Date.now()

  const session: MintSession = {
    ...data,
    createdAt: now,
    expiresAt: now + SESSION_EXPIRY_MS,
  }

  sessionStore.set(sessionId, session)

  // 确保清理定时器已启动
  ensureCleanupTimer()

  return sessionId
}

/**
 * 获取铸造会话
 *
 * @param sessionId - 会话 ID
 * @returns 会话数据，如果不存在或已过期则返回 null
 */
export function getMintSession(sessionId: string): MintSession | null {
  const session = sessionStore.get(sessionId)

  if (!session) {
    return null
  }

  // 检查是否过期
  if (Date.now() > session.expiresAt) {
    // 删除过期会话
    sessionStore.delete(sessionId)
    return null
  }

  return session
}

/**
 * 删除铸造会话
 *
 * @param sessionId - 会话 ID
 */
export function deleteMintSession(sessionId: string): void {
  sessionStore.delete(sessionId)
}

/**
 * 清理所有过期会话
 *
 * @returns 清理的会话数量
 */
export function cleanExpiredMintSessions(): number {
  const now = Date.now()
  let cleanedCount = 0

  for (const [sessionId, session] of sessionStore.entries()) {
    if (now > session.expiresAt) {
      sessionStore.delete(sessionId)
      cleanedCount++
    }
  }

  return cleanedCount
}

/**
 * 获取当前会话数量（用于调试/监控）
 */
export function getMintSessionCount(): number {
  return sessionStore.size
}

/**
 * 清除所有会话（用于测试）
 */
export function clearAllMintSessions(): void {
  sessionStore.clear()
}

/**
 * 确保清理定时器已启动
 */
function ensureCleanupTimer(): void {
  if (cleanupTimer === null) {
    cleanupTimer = setInterval(() => {
      cleanExpiredMintSessions()

      // 如果没有会话了，停止定时器
      if (sessionStore.size === 0 && cleanupTimer !== null) {
        clearInterval(cleanupTimer)
        cleanupTimer = null
      }
    }, CLEANUP_INTERVAL_MS)

    // 确保定时器不会阻止进程退出
    if (cleanupTimer.unref) {
      cleanupTimer.unref()
    }
  }
}

/**
 * 停止清理定时器（用于测试清理）
 */
export function stopMintCleanupTimer(): void {
  if (cleanupTimer !== null) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}

/**
 * 获取会话过期时间（毫秒）- 用于测试
 */
export function getSessionExpiryMs(): number {
  return SESSION_EXPIRY_MS
}
