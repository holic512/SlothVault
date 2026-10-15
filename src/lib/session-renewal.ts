/**
 * @file session-renewal.ts
 * @project SlothVault
 * @module Session Activity Scheduler
 * @description Throttles activity-driven renewal and ignores responses from superseded identities.
 * @logic Renew only visible authenticated activity, serialize attempts, invalidate in-flight work on identity transitions, and retain identity on transient failures.
 * @dependencies api-client error type, user DTO
 * @index_tags session,renewal,concurrency,activity
 * @author holic512
 */
import { ApiClientError } from '@/lib/api-client'
import type { SessionRenewal } from '@/types/user'

export const SESSION_RENEW_INTERVAL_MS = 5 * 60 * 1000

export function createSessionRenewalController(options: {
  renew: (signal: AbortSignal) => Promise<SessionRenewal>
  apply: (result: SessionRenewal) => void
  expired: () => void
  now?: () => number
}) {
  const now = options.now ?? Date.now
  let nextAttempt = 0
  let pending: AbortController | null = null
  let generation = 0
  function reset() {
    generation++
    pending?.abort()
    pending = null
    nextAttempt = 0
  }
  async function activity(visible: boolean, authenticated: boolean) {
    if (!visible || !authenticated || pending || now() < nextAttempt) return
    const version = generation
    const controller = new AbortController()
    pending = controller
    nextAttempt = now() + SESSION_RENEW_INTERVAL_MS
    try {
      const result = await options.renew(controller.signal)
      if (version === generation) options.apply(result)
    } catch (error) {
      if (version !== generation) return
      if (error instanceof ApiClientError && error.status === 401) {
        reset()
        options.expired()
      } else {
        // Retry only on a later real activity, never a background keepalive loop.
        nextAttempt = now() + 30_000
      }
    } finally {
      if (version === generation) pending = null
    }
  }
  return { activity, reset }
}
