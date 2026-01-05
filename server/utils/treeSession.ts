/**
 * 树创建会话管理模块
 * 
 * 用于临时存储树创建过程中的会话数据，包括：
 * - 树 Keypair（用于后续签名）
 * - 加密后的私钥
 * - 树配置参数
 * 
 * 会话在 5 分钟后自动过期，防止内存泄漏
 */

import { randomBytes } from 'node:crypto'
import type { Keypair } from '@solana/web3.js'

// 会话过期时间（毫秒）- 5 分钟
const SESSION_EXPIRY_MS = 5 * 60 * 1000

// 清理间隔（毫秒）- 1 分钟
const CLEANUP_INTERVAL_MS = 60 * 1000

/**
 * 树创建会话数据结构
 */
export interface TreeSession {
  /** 树 Keypair（包含公钥和私钥） */
  treeKeypair: Keypair
  /** 加密后的私钥（用于持久化存储） */
  encryptedKey: string
  /** 树名称 */
  name: string
  /** 树的最大深度 */
  maxDepth: number
  /** 最大缓冲区大小 */
  maxBufferSize: number
  /** 树冠深度 */
  canopyDepth: number
  /** 网络类型 */
  network: string
  /** 支付者地址 */
  payerAddress: string
  /** 租金（lamports） */
  rentLamports: number
  /** 会话创建时间戳 */
  createdAt: number
  /** 会话过期时间戳 */
  expiresAt: number
}

/**
 * 创建会话时的输入数据（不包含时间戳）
 */
export type CreateSessionInput = Omit<TreeSession, 'createdAt' | 'expiresAt'>

// 内存会话存储
const sessionStore = new Map<string, TreeSession>()

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
 * 创建新会话
 * 
 * @param data - 会话数据（不包含时间戳）
 * @returns 会话 ID
 */
export function createTreeSession(data: CreateSessionInput): string {
  const sessionId = generateSessionId()
  const now = Date.now()

  const session: TreeSession = {
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
 * 获取会话
 * 
 * @param sessionId - 会话 ID
 * @returns 会话数据，如果不存在或已过期则返回 null
 */
export function getTreeSession(sessionId: string): TreeSession | null {
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
 * 删除会话
 * 
 * @param sessionId - 会话 ID
 */
export function deleteTreeSession(sessionId: string): void {
  sessionStore.delete(sessionId)
}

/**
 * 清理所有过期会话
 * 
 * @returns 清理的会话数量
 */
export function cleanExpiredSessions(): number {
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
export function getSessionCount(): number {
  return sessionStore.size
}

/**
 * 清除所有会话（用于测试）
 */
export function clearAllSessions(): void {
  sessionStore.clear()
}

/**
 * 确保清理定时器已启动
 */
function ensureCleanupTimer(): void {
  if (cleanupTimer === null) {
    cleanupTimer = setInterval(() => {
      cleanExpiredSessions()

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
export function stopCleanupTimer(): void {
  if (cleanupTimer !== null) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}
