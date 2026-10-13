/**
 * @file account-security.ts
 * @project SlothVault
 * @module Account Security Contracts
 * @description Defines browser-safe multi-wallet, credential quota, and operation-bound proof contracts.
 * @logic Distinguish login from authenticated mutations and carry only public targets in wallet messages.
 * @dependencies user DTO
 * @index_tags account,wallet,credentials,reauthentication,contract
 * @author holic512
 */
import type { SessionUser } from '@/types/user'

export type WalletBinding = { id: string; address: string; createdAt: string }
export type UsernameChangeQuota = { month: string; limit: number; used: number; remaining: number; resetsAt: string }
export type AccountCredentials = { username: string; passwordConfigured: boolean; usernameChangeQuota: UsernameChangeQuota }
export type AccountAction =
  | { action: 'bind'; address: string }
  | { action: 'replace'; walletId: string; address: string }
  | { action: 'unbind'; walletId: string }
  | { action: 'credentials'; username?: string; passwordChange: boolean }
export type WalletChallengePurpose = 'login' | 'bind' | 'replace' | 'reauth'
export type WalletProof = { challengeId: string; address: string; signature: string }
export type ReauthenticationProof = { method: 'password'; password: string } | ({ method: 'wallet' } & WalletProof)
export type WalletChallenge = { challengeId: string; address: string; message: string; expiresAt: number }
export type WalletMutationResult = { user: SessionUser; wallets: WalletBinding[] }
export type CredentialsMutationResult = { user: SessionUser; credentials: AccountCredentials; passwordChanged: boolean }
