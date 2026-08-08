import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import nacl from 'tweetnacl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  issueSession: vi.fn(),
  storeEphemeralJson: vi.fn(),
  consumeEphemeralJson: vi.fn(),
  prisma: {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/server/auth/password', () => ({ hashPassword: mocks.hashPassword }))
vi.mock('@/server/auth/session', () => ({ issueSession: mocks.issueSession }))
vi.mock('@/server/short-lived-state', () => ({
  shortLivedStateKey: (...segments: Array<string | number>) => segments.join(':'),
  storeEphemeralJson: mocks.storeEphemeralJson,
  consumeEphemeralJson: mocks.consumeEphemeralJson,
}))
vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))

import {
  createWalletLoginChallenge,
  verifyWalletLogin,
} from '@/server/services/wallet-auth'

function walletUser(address: string) {
  const now = new Date('2026-07-31T00:00:00.000Z')
  return {
    id: 9,
    username: `wallet_${address.slice(0, 8).toLowerCase()}`,
    email: null,
    password: 'random-argon2-hash',
    passwordConfigured: false,
    displayName: `Wallet ${address.slice(0, 4)}…${address.slice(-4)}`,
    avatar: null,
    bio: null,
    role: 'USER',
    status: 1,
    pointsBalance: 0,
    walletAddress: address,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

describe('optional wallet authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stores a short-lived in-memory challenge with the current account binding', async () => {
    const address = Keypair.generate().publicKey.toBase58()
    mocks.storeEphemeralJson.mockResolvedValue(true)

    const challenge = await createWalletLoginChallenge({ address, userId: 17 })

    expect(challenge.address).toBe(address)
    expect(challenge.message).toContain('purpose:account-login')
    expect(challenge.message).toContain(`address:${address}`)
    expect(mocks.storeEphemeralJson).toHaveBeenCalledWith(
      `wallet-login:${challenge.challengeId}`,
      expect.objectContaining({
        address,
        message: challenge.message,
        userId: 17,
      }),
      300,
    )
  })

  it('provisions a regular user after one valid signature and issues the shared session', async () => {
    const keypair = Keypair.generate()
    const address = keypair.publicKey.toBase58()
    const message = [
      'SlothVault sign in',
      'purpose:account-login',
      `address:${address}`,
      'challenge:11111111-1111-4111-8111-111111111111',
      'nonce:test',
      `expires:${Date.now() + 60_000}`,
    ].join('\n')
    const signature = bs58.encode(
      nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey),
    )
    mocks.consumeEphemeralJson.mockResolvedValue({
      address,
      message,
      expiresAt: Date.now() + 60_000,
      userId: null,
    })
    mocks.prisma.user.findUnique.mockResolvedValue(null)
    mocks.hashPassword.mockResolvedValue('random-argon2-hash')
    mocks.prisma.user.create.mockResolvedValue(walletUser(address))
    mocks.prisma.user.update.mockResolvedValue(walletUser(address))
    mocks.issueSession.mockResolvedValue({
      token: 'session-token',
      expiresAt: new Date('2026-08-07T00:00:00.000Z'),
      sessionId: 'session-id',
    })

    const result = await verifyWalletLogin({
      challengeId: '11111111-1111-4111-8111-111111111111',
      address,
      signature,
      ip: '127.0.0.1',
      userAgent: 'vitest',
    })

    expect(mocks.consumeEphemeralJson).toHaveBeenCalledOnce()
    expect(mocks.prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        walletAddress: address,
        passwordConfigured: false,
        role: 'USER',
        status: 1,
      }),
    })
    expect(mocks.issueSession).toHaveBeenCalledWith({
      userId: 9,
      ip: '127.0.0.1',
      userAgent: 'vitest',
    })
    expect(result.user).toMatchObject({ role: 'USER', walletAddress: address })
  })
})
