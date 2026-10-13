/**
 * @file wallet-auth.ts
 * @project SlothVault
 * @module Wallet Authentication
 * @description Owns one-time, purpose-bound Solana challenges and multi-wallet account login.
 * @logic Bind authenticated proofs to session and credential revision, verify exact Ed25519 message bytes, and provision accounts with authoritative wallet bindings atomically.
 * @dependencies Solana PublicKey, tweetnacl, short-lived state, Prisma, session, wallet-login contract
 * @index_tags wallet,login,challenge,reauthentication,multi-wallet
 * @author holic512
 */
import 'server-only'
import { randomBytes, randomUUID } from 'node:crypto'
import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import nacl from 'tweetnacl'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { accountActionTarget } from '@/lib/account-credentials'
import { buildWalletLoginMessage } from '@/lib/wallet-login'
import { hashPassword } from '@/server/auth/password'
import { USER_ROLE, USER_STATUS } from '@/server/auth/roles'
import { issueSession } from '@/server/auth/session'
import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { consumeEphemeralJson, shortLivedStateKey, storeEphemeralJson } from '@/server/short-lived-state'
import { userDto } from '@/server/services/user-auth'
import type { AccountAction, WalletChallengePurpose, WalletProof } from '@/types/account-security'

export type CredentialContext = { userId: number; sessionId: string }
type StoredWalletChallenge = { address: string; message: string; expiresAt: number; purpose: WalletChallengePurpose; target: string | null; userId: number | null; sessionId: string | null; credentialsRevision: number | null }
export function securityError(reason: string, status = 409): never { throw new HttpError(reason, status, status, { reason }) }
export function canonicalWalletAddress(value: string) {
  try { return new PublicKey(value.trim()).toBase58() } catch { return securityError('WALLET_ADDRESS_INVALID', 400) }
}
export async function activeCredentialUser(tx: Prisma.TransactionClient, context: CredentialContext) {
  const session = await tx.session.findUnique({ where: { id: context.sessionId }, include: { User: true } })
  if (!session || session.userId !== context.userId || session.revokedAt || session.expiresAt.getTime() <= Date.now() || session.User.status !== USER_STATUS.ACTIVE) securityError('SESSION_CHANGED', 401)
  return session.User
}
export async function createWalletLoginChallenge(input: { purpose: WalletChallengePurpose; address: string; target?: AccountAction; context?: CredentialContext }) {
  const address = canonicalWalletAddress(input.address)
  let userId: number | null = null, sessionId: string | null = null, credentialsRevision: number | null = null
  const target = input.target ? accountActionTarget(input.target) : null
  if (input.purpose !== 'login') {
    if (!input.context || !input.target) securityError('REAUTH_REQUIRED', 401)
    const user = await activeCredentialUser(prisma, input.context)
    userId = user.id; sessionId = input.context.sessionId; credentialsRevision = user.credentialsRevision
    if (input.purpose === 'reauth') {
      const owner = await prisma.userWallet.findUnique({ where: { address } })
      if (owner?.userId !== user.id) securityError('WALLET_NOT_BOUND', 403)
    } else if (input.target.action !== input.purpose || !('address' in input.target) || input.target.address !== address) securityError('WALLET_PURPOSE_MISMATCH', 400)
  } else if (input.target || input.context) securityError('WALLET_PURPOSE_MISMATCH', 400)
  const challengeId = randomUUID(), nonce = randomBytes(24).toString('hex'), expiresAt = Date.now() + 300_000
  const message = buildWalletLoginMessage({ address, challengeId, nonce, expiresAt, purpose: input.purpose, target })
  const stored = await storeEphemeralJson(shortLivedStateKey('wallet-login', challengeId), { address, message, expiresAt, purpose: input.purpose, target, userId, sessionId, credentialsRevision } satisfies StoredWalletChallenge, 300)
  if (!stored) securityError('WALLET_CHALLENGE_UNAVAILABLE', 503)
  return { challengeId, address, message, expiresAt }
}
export async function consumeWalletProof(input: WalletProof, expected: { purpose: WalletChallengePurpose; target?: AccountAction; context?: CredentialContext; credentialsRevision?: number }) {
  const address = canonicalWalletAddress(input.address)
  const challenge = await consumeEphemeralJson<StoredWalletChallenge>(shortLivedStateKey('wallet-login', input.challengeId))
  if (!challenge || challenge.expiresAt <= Date.now() || challenge.address !== address) securityError('WALLET_CHALLENGE_EXPIRED', 401)
  if (challenge.purpose !== expected.purpose || challenge.target !== (expected.target ? accountActionTarget(expected.target) : null)) securityError('WALLET_PURPOSE_MISMATCH', 401)
  if (expected.context && (challenge.userId !== expected.context.userId || challenge.sessionId !== expected.context.sessionId || challenge.credentialsRevision !== expected.credentialsRevision)) securityError('SESSION_CHANGED', 401)
  let signature: Uint8Array
  try { signature = bs58.decode(input.signature) } catch { return securityError('WALLET_SIGNATURE_INVALID', 401) }
  if (signature.length !== nacl.sign.signatureLength || !nacl.sign.detached.verify(new TextEncoder().encode(challenge.message), signature, new PublicKey(address).toBytes())) securityError('WALLET_SIGNATURE_INVALID', 401)
  return address
}
export async function verifyWalletLogin(input: WalletProof & { ip: string | null; userAgent: string | null }) {
  const address = await consumeWalletProof(input, { purpose: 'login' })
  const password = await hashPassword(randomBytes(32).toString('hex'))
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await unitOfWork.execute(async tx => {
        const binding = await tx.userWallet.findUnique({ where: { address }, include: { user: true } })
        let user = binding?.user
        if (!user) user = await tx.user.create({ data: {
          username: `wallet_${address.slice(0, 8).toLowerCase()}_${randomBytes(4).toString('hex')}`,
          password, passwordConfigured: false, displayName: `Wallet ${address.slice(0, 4)}…${address.slice(-4)}`,
          walletAddress: address, role: USER_ROLE.USER, status: USER_STATUS.ACTIVE, wallets: { create: { address } },
        } })
        if (user.status !== USER_STATUS.ACTIVE) securityError('ACCOUNT_DISABLED', 403)
        user = await tx.user.update({ where: { id: user.id, status: USER_STATUS.ACTIVE, credentialsRevision: user.credentialsRevision, wallets: { some: { address } } }, data: { lastLoginAt: new Date(), updatedAt: new Date() } })
        const session = await issueSession({ userId: user.id, ip: input.ip, userAgent: input.userAgent }, tx)
        return { user: userDto(user), session }
      })
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
      if (!['P2002', 'P2034', 'P2025'].includes(code)) throw error
    }
  }
  return securityError('CREDENTIALS_CHANGED')
}
