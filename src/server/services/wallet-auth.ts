/**
 * @file wallet-auth.ts
 * @project SlothVault
 * @module Optional Wallet Authentication
 * @description Implements process-memory Solana message challenges for optional account login or wallet binding.
 * @logic Validate a canonical address, store one process-local short-lived challenge, consume it exactly once, verify Ed25519 ownership, then recheck active identity, bind or provision a regular account and issue its session in the same transaction.
 * @dependencies @solana/web3.js, bs58, tweetnacl, short-lived state, Prisma User model, wallet-login contract
 * @index_tags wallet,login,binding,memory,challenge,web2
 * @author holic512
 */
import 'server-only'

import { randomBytes, randomUUID } from 'node:crypto'

import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import nacl from 'tweetnacl'

import { buildWalletLoginMessage } from '@/lib/wallet-login'
import { hashPassword } from '@/server/auth/password'
import { USER_ROLE, USER_STATUS } from '@/server/auth/roles'
import { issueSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { unitOfWork } from '@/server/database/unit-of-work'
import {
  consumeEphemeralJson,
  shortLivedStateKey,
  storeEphemeralJson,
} from '@/server/short-lived-state'
import { userDto } from '@/server/services/user-auth'

const WALLET_CHALLENGE_TTL_SECONDS = 5 * 60

type StoredWalletChallenge = {
  address: string
  message: string
  expiresAt: number
  userId: number | null
}

function canonicalWalletAddress(value: string) {
  try {
    return new PublicKey(value.trim()).toBase58()
  } catch {
    throw new HttpError('Invalid wallet address', 400, 400)
  }
}

export async function createWalletLoginChallenge(input: {
  address: string
  userId?: number | null
}) {
  const address = canonicalWalletAddress(input.address)
  const challengeId = randomUUID()
  const nonce = randomBytes(24).toString('hex')
  const expiresAt = Date.now() + WALLET_CHALLENGE_TTL_SECONDS * 1000
  const message = buildWalletLoginMessage({ address, challengeId, nonce, expiresAt })
  const stored = await storeEphemeralJson(
    shortLivedStateKey('wallet-login', challengeId),
    { address, message, expiresAt, userId: input.userId ?? null } satisfies StoredWalletChallenge,
    WALLET_CHALLENGE_TTL_SECONDS,
  )
  if (!stored) throw new HttpError('Unable to create wallet challenge', 503, 5034)
  return { challengeId, address, message, expiresAt }
}

async function provisionWalletUser(tx: Prisma.TransactionClient, address: string, password: string) {
  return tx.user.upsert({
    where: { walletAddress: address }, update: {},
    create: {
      username: `wallet_${address.slice(0, 8).toLowerCase()}_${randomBytes(4).toString('hex')}`,
      password, passwordConfigured: false,
      displayName: `Wallet ${address.slice(0, 4)}…${address.slice(-4)}`,
      walletAddress: address, role: USER_ROLE.USER, status: USER_STATUS.ACTIVE,
    },
  })
}

export async function verifyWalletLogin(input: {
  challengeId: string
  address: string
  signature: string
  ip: string | null
  userAgent: string | null
}) {
  const address = canonicalWalletAddress(input.address)
  const challenge = await consumeEphemeralJson<StoredWalletChallenge>(
    shortLivedStateKey('wallet-login', input.challengeId),
  )
  if (!challenge || challenge.expiresAt <= Date.now() || challenge.address !== address) {
    throw new HttpError('Wallet challenge is invalid or expired', 401, 401)
  }

  let signature: Uint8Array
  try {
    signature = bs58.decode(input.signature)
  } catch {
    throw new HttpError('Invalid wallet signature', 401, 401)
  }
  const verified = nacl.sign.detached.verify(
    new TextEncoder().encode(challenge.message),
    signature,
    new PublicKey(address).toBytes(),
  )
  if (!verified) throw new HttpError('Invalid wallet signature', 401, 401)

  const password = challenge.userId ? '' : await hashPassword(randomBytes(32).toString('hex'))
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await unitOfWork.execute(async tx => {
        let user
        if (challenge.userId) {
          const target = await tx.user.findUnique({ where: { id: challenge.userId } })
          if (!target) throw new HttpError('Wallet binding account no longer exists', 401, 401)
          if (target.status !== USER_STATUS.ACTIVE) throw new HttpError('Account is disabled', 403, 403)
          const owner = await tx.user.findUnique({ where: { walletAddress: address } })
          if (owner && owner.id !== target.id) throw new HttpError('Wallet is already linked to another account', 409, 409)
          user = await tx.user.update({ where: { id: target.id, status: USER_STATUS.ACTIVE }, data: { walletAddress: address, lastLoginAt: new Date(), updatedAt: new Date() } })
        } else {
          user = await provisionWalletUser(tx, address, password)
          if (user.status !== USER_STATUS.ACTIVE) throw new HttpError('Account is disabled', 403, 403)
          user = await tx.user.update({ where: { id: user.id, status: USER_STATUS.ACTIVE }, data: { lastLoginAt: new Date(), updatedAt: new Date() } })
        }
        const session = await issueSession({ userId: user.id, ip: input.ip, userAgent: input.userAgent }, tx)
        return { user: userDto(user), session }
      })
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
      if (code === 'P2025' && challenge.userId) throw new HttpError('Wallet binding account no longer exists', 401, 401)
      if (!['P2002', 'P2034', 'P2025'].includes(String(code))) throw error
    }
  }
  throw new HttpError('Wallet account changed; retry login', 409, 409)
}
