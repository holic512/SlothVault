import { randomBytes } from 'node:crypto'
import type { Keypair } from '@solana/web3.js'

const SESSION_EXPIRY_MS = 5 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60 * 1000

export interface ProjectPurchaseSession {
  purchaseRecordId: bigint
  cnftId: bigint
  merkleTreeId: bigint
  merkleTreeAddress: string
  leafIndex: number
  buyerWalletAddress: string
  receiverWalletAddress: string
  priceLamports: bigint
  network: 'mainnet' | 'devnet'
  treeAuthorityKeypair: Keypair
  createdAt: number
  expiresAt: number
}

export type CreateProjectPurchaseSessionInput = Omit<ProjectPurchaseSession, 'createdAt' | 'expiresAt'>

const sessionStore = new Map<string, ProjectPurchaseSession>()
let cleanupTimer: ReturnType<typeof setInterval> | null = null

function generateSessionId(): string {
  return randomBytes(32).toString('hex')
}

export function createProjectPurchaseSession(data: CreateProjectPurchaseSessionInput): string {
  const sessionId = generateSessionId()
  const now = Date.now()

  sessionStore.set(sessionId, {
    ...data,
    createdAt: now,
    expiresAt: now + SESSION_EXPIRY_MS,
  })

  ensureCleanupTimer()
  return sessionId
}

export function getProjectPurchaseSession(sessionId: string): ProjectPurchaseSession | null {
  const session = sessionStore.get(sessionId)
  if (!session) {
    return null
  }

  if (Date.now() > session.expiresAt) {
    sessionStore.delete(sessionId)
    return null
  }

  return session
}

export function deleteProjectPurchaseSession(sessionId: string): void {
  sessionStore.delete(sessionId)
}

function ensureCleanupTimer(): void {
  if (cleanupTimer) {
    return
  }

  cleanupTimer = setInterval(() => {
    const now = Date.now()

    for (const [sessionId, session] of sessionStore.entries()) {
      if (now > session.expiresAt) {
        sessionStore.delete(sessionId)
      }
    }

    if (sessionStore.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer)
      cleanupTimer = null
    }
  }, CLEANUP_INTERVAL_MS)

  cleanupTimer.unref?.()
}
