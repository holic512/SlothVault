/**
 * @file login-rate-limit.ts
 * @project SlothVault
 * @module Password Login Boundary
 * @description Shares one attempt budget across the public and legacy administrator login endpoints.
 * @logic Key password attempts by the same client identity so switching endpoints cannot reset the limit.
 * @dependencies short-lived-state
 * @index_tags auth,login,rate-limit
 * @author holic512
 */
import 'server-only'
import { enforceRateLimit } from '@/server/short-lived-state'

export function enforcePasswordLoginRateLimit(ip: string) {
  return enforceRateLimit({ scope: 'login', identity: ip, limit: 12, windowSeconds: 15 * 60 })
}
