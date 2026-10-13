/**
 * @file account-security.ts
 * @project SlothVault
 * @module Personal Credential Management
 * @description Manages operation-bound reauthentication, multi-wallet mutations and monthly username changes.
 * @logic Recheck the active session, claim a credential revision, enforce login-method and quota invariants, and commit credential/projection/session changes atomically.
 * @dependencies Prisma, unit-of-work, wallet-auth proofs, password hashing, account credential policy
 * @index_tags account,wallet,credentials,quota,transaction,security
 * @author holic512
 */
import 'server-only'
import type { Prisma, User } from '@generated/prisma-postgresql/client'
import { usernameChangeQuota } from '@/lib/account-credentials'
import { hashPassword, verifyPassword } from '@/server/auth/password'
import { unitOfWork } from '@/server/database/unit-of-work'
import { prisma } from '@/server/prisma'
import { userDto } from '@/server/services/user-auth'
import { activeCredentialUser, canonicalWalletAddress, consumeWalletProof, securityError, type CredentialContext } from '@/server/services/wallet-auth'
import type { AccountAction, ReauthenticationProof, WalletProof } from '@/types/account-security'

export function credentialsDto(user: User) { return { username: user.username, passwordConfigured: user.passwordConfigured, usernameChangeQuota: usernameChangeQuota(user) } }
export async function getAccountCredentials(userId: number) { return credentialsDto(await prisma.user.findUniqueOrThrow({ where: { id: userId } })) }
export async function listAccountWallets(userId: number, tx: Pick<Prisma.TransactionClient, 'userWallet'> = prisma) {
  const wallets = await tx.userWallet.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  return wallets.map(wallet => ({ id: String(wallet.id), address: wallet.address, createdAt: wallet.createdAt.toISOString() }))
}
async function reauthenticate(tx: Prisma.TransactionClient, context: CredentialContext, user: User, target: AccountAction, proof: ReauthenticationProof) {
  if (proof.method === 'password') {
    if (!user.passwordConfigured || !await verifyPassword(user.password, proof.password)) securityError('PASSWORD_INCORRECT', 401)
  } else {
    const address = await consumeWalletProof(proof, { purpose: 'reauth', target, context, credentialsRevision: user.credentialsRevision })
    if ((await tx.userWallet.findUnique({ where: { address } }))?.userId !== user.id) securityError('WALLET_NOT_BOUND', 403)
  }
}
async function claimRevision(tx: Prisma.TransactionClient, user: User) {
  const claimed = await tx.user.updateMany({ where: { id: user.id, status: 1, credentialsRevision: user.credentialsRevision }, data: { credentialsRevision: { increment: 1 }, updatedAt: new Date() } })
  if (claimed.count !== 1) securityError('CREDENTIALS_CHANGED')
}
async function revokeOtherSessions(tx: Prisma.TransactionClient, context: CredentialContext, all = false) {
  await tx.session.updateMany({ where: { userId: context.userId, revokedAt: null, ...(!all ? { id: { not: context.sessionId } } : {}) }, data: { revokedAt: new Date() } })
}
export async function synchronizeWalletAddress(tx: Prisma.TransactionClient, userId: number) {
  const first = await tx.userWallet.findFirst({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  return tx.user.update({ where: { id: userId }, data: { walletAddress: first?.address ?? null, updatedAt: new Date() } })
}
function credentialConflict(error: unknown, reason: string): never {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === 'P2002') securityError(reason)
  if (['P2025', 'P2034'].includes(code)) securityError('CREDENTIALS_CHANGED')
  throw error
}
export async function mutateAccountWallet(context: CredentialContext, input: { target: Exclude<AccountAction, { action: 'credentials' }>; reauth: ReauthenticationProof; ownership?: WalletProof }) {
  const target = 'address' in input.target ? { ...input.target, address: canonicalWalletAddress(input.target.address) } : input.target
  try {
    return await unitOfWork.execute(async tx => {
      const user = await activeCredentialUser(tx, context)
      if (target.action === 'unbind') {
        const count = await tx.userWallet.count({ where: { userId: user.id } })
        if (count <= 1 && !user.passwordConfigured) securityError('LAST_LOGIN_METHOD')
        if (count <= 1 && input.reauth.method !== 'password') securityError('LAST_WALLET_PASSWORD_REQUIRED', 401)
      }
      await reauthenticate(tx, context, user, target, input.reauth)
      if (target.action !== 'unbind') {
        if (!input.ownership) securityError('WALLET_SIGNATURE_INVALID', 401)
        const address = await consumeWalletProof(input.ownership, { purpose: target.action, target, context, credentialsRevision: user.credentialsRevision })
        if (address !== target.address) securityError('WALLET_PURPOSE_MISMATCH', 401)
        const existing = await tx.userWallet.findUnique({ where: { address } })
        if (existing) {
          if (target.action === 'bind' && existing.userId === user.id) return { user: userDto(user), wallets: await listAccountWallets(user.id, tx) }
          securityError('WALLET_ALREADY_BOUND')
        }
      }
      await claimRevision(tx, user)
      if (target.action !== 'bind') {
        const old = await tx.userWallet.findFirst({ where: { id: Number(target.walletId), userId: user.id } })
        if (!old) securityError('WALLET_NOT_BOUND', 404)
        await tx.userWallet.delete({ where: { id: old.id } })
      }
      if (target.action !== 'unbind') await tx.userWallet.create({ data: { userId: user.id, address: target.address } })
      const updated = await synchronizeWalletAddress(tx, user.id)
      await revokeOtherSessions(tx, context)
      return { user: userDto(updated), wallets: await listAccountWallets(user.id, tx) }
    })
  } catch (error) { return credentialConflict(error, 'WALLET_ALREADY_BOUND') }
}
export async function updateAccountCredentials(context: CredentialContext, input: { username?: string; newPassword?: string; reauth: ReauthenticationProof }) {
  const username = input.username?.trim().toLowerCase()
  const target: AccountAction = { action: 'credentials', ...(username !== undefined ? { username } : {}), passwordChange: input.newPassword !== undefined }
  const password = input.newPassword !== undefined ? await hashPassword(input.newPassword) : undefined
  try {
    return await unitOfWork.execute(async tx => {
      const user = await activeCredentialUser(tx, context)
      const renamed = username !== undefined && username !== user.username
      if (!renamed && password === undefined) return { user: userDto(user), credentials: credentialsDto(user), passwordChanged: false }
      await reauthenticate(tx, context, user, target, input.reauth)
      const quota = usernameChangeQuota(user)
      if (renamed && quota.remaining === 0) securityError('USERNAME_CHANGE_LIMIT_REACHED')
      await claimRevision(tx, user)
      const updated = await tx.user.update({ where: { id: user.id }, data: {
        ...(renamed ? { username, usernameChangeMonth: quota.month, usernameChangeCount: quota.used + 1 } : {}),
        ...(password !== undefined ? { password, passwordConfigured: true } : {}), updatedAt: new Date(),
      } })
      await revokeOtherSessions(tx, context, password !== undefined)
      return { user: userDto(updated), credentials: credentialsDto(updated), passwordChanged: password !== undefined }
    })
  } catch (error) { return credentialConflict(error, 'USERNAME_TAKEN') }
}
