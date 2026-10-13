/**
 * @file account-credentials.ts
 * @project SlothVault
 * @module Credential Policy
 * @description Provides deterministic operation targets and Beijing-calendar username quotas.
 * @logic Normalize only human usernames, serialize typed targets without secrets, and derive monthly resets from UTC plus eight hours.
 * @dependencies account-security types
 * @index_tags credentials,quota,timezone,reauthentication
 * @author holic512
 */
import type { AccountAction, UsernameChangeQuota } from '@/types/account-security'

export function accountActionTarget(target: AccountAction): string {
  switch (target.action) {
    case 'bind': return JSON.stringify({ action: 'bind', address: target.address })
    case 'replace': return JSON.stringify({ action: 'replace', walletId: target.walletId, address: target.address })
    case 'unbind': return JSON.stringify({ action: 'unbind', walletId: target.walletId })
    case 'credentials': return JSON.stringify({ action: 'credentials', ...(target.username !== undefined ? { username: target.username.trim().toLowerCase() } : {}), passwordChange: target.passwordChange })
  }
}

export function usernameChangeQuota(user: { usernameChangeMonth: string | null; usernameChangeCount: number }, now = new Date()): UsernameChangeQuota {
  // Asia/Shanghai has a fixed UTC+08:00 offset throughout the supported contemporary account lifecycle.
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const year = local.getUTCFullYear(), monthIndex = local.getUTCMonth()
  const month = `${year}-${String(monthIndex + 1).padStart(2, '0')}`
  const used = user.usernameChangeMonth === month ? user.usernameChangeCount : 0
  return { month, limit: 3, used, remaining: Math.max(0, 3 - used), resetsAt: new Date(Date.UTC(year, monthIndex + 1, 1) - 8 * 60 * 60 * 1000).toISOString() }
}
