/**
 * @file credential-rate-limit.ts
 * @project SlothVault
 * @module Credential Attempt Limits
 * @description Limits personal credential proofs separately from ordinary account login.
 * @logic Bound both IP and account proof attempts, with tighter limits for password verification.
 * @dependencies short-lived state
 * @index_tags credentials,rate-limit,security
 * @author holic512
 */
import { enforceRateLimit } from '@/server/short-lived-state'
import type { ReauthenticationProof } from '@/types/account-security'
export async function limitCredentialAttempt(userId: number, ip: string, proof: ReauthenticationProof) {
  for (const identity of [`ip:${ip}`, `user:${userId}`]) await enforceRateLimit({ scope: proof.method === 'password' ? 'credential-password' : 'credential-wallet', identity, limit: proof.method === 'password' ? 12 : 16, windowSeconds: 900 })
}
