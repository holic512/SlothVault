/**
 * @file account-security-error.ts
 * @project SlothVault
 * @module Personal Security Error Mapping
 * @description Maps server and wallet failures to safe localized account-security reasons.
 * @logic Prefer structured business reasons, distinguish cancellation and session expiry, and never display raw provider payloads.
 * @dependencies api-client
 * @index_tags account,wallet,errors,localization,security
 * @author holic512
 */
import { ApiClientError } from '@/lib/api-client'
export function accountSecurityErrorReason(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.data && typeof error.data === 'object' && 'reason' in error.data && typeof error.data.reason === 'string') return error.data.reason
    return error.status === 401 ? 'SESSION_CHANGED' : error.status === 429 ? 'RATE_LIMITED' : 'WALLET_OPERATION_FAILED'
  }
  if (error && typeof error === 'object' && 'reason' in error && typeof error.reason === 'string') return error.reason
  if (error instanceof Error && /reject|cancel|declin/i.test(error.message)) return 'WALLET_CANCELLED'
  return 'WALLET_OPERATION_FAILED'
}
