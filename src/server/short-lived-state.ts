/**
 * @file short-lived-state.ts
 * @project SlothVault
 * @module In-memory Short-lived State
 * @description Provides process-local TTL storage for one-time wallet challenges and abuse controls in single-instance deployments.
 * @logic Serialize challenge values, consume them once without yielding, count requests in fixed windows, lazily remove expired entries, cap memory growth, and discard all state when the process restarts.
 * @dependencies server/http/errors
 * @index_tags memory,ephemeral-state,rate-limit,authentication,challenge,single-instance
 * @author holic512
 */
import 'server-only'

import { HttpError } from '@/server/http/errors'

const SWEEP_INTERVAL_MS = 60_000
const MAX_EPHEMERAL_ENTRIES = 10_000
const MAX_RATE_LIMIT_ENTRIES = 50_000

type EphemeralEntry = {
  serialized: string
  expiresAt: number
}

type RateLimitEntry = {
  count: number
  expiresAt: number
}

type ShortLivedState = {
  ephemeral: Map<string, EphemeralEntry>
  rateLimits: Map<string, RateLimitEntry>
  nextSweepAt: number
}

const globalForShortLivedState = globalThis as unknown as {
  slothVaultShortLivedState?: ShortLivedState
}

function getShortLivedState() {
  globalForShortLivedState.slothVaultShortLivedState ??= {
    ephemeral: new Map(),
    rateLimits: new Map(),
    nextSweepAt: 0,
  }
  return globalForShortLivedState.slothVaultShortLivedState
}

function sweepExpiredEntries(state: ShortLivedState, now: number, force = false) {
  if (!force && now < state.nextSweepAt) return

  for (const [key, entry] of state.ephemeral) {
    if (entry.expiresAt <= now) state.ephemeral.delete(key)
  }
  for (const [key, entry] of state.rateLimits) {
    if (entry.expiresAt <= now) state.rateLimits.delete(key)
  }
  state.nextSweepAt = now + SWEEP_INTERVAL_MS
}

function assertCapacity(
  state: ShortLivedState,
  entries: Map<string, unknown>,
  maximum: number,
  now: number,
) {
  if (entries.size < maximum) return
  sweepExpiredEntries(state, now, true)
  if (entries.size >= maximum) {
    throw new HttpError('Authentication service is temporarily unavailable', 503, 5034)
  }
}

export function shortLivedStateKey(...segments: Array<string | number>) {
  return segments.map((segment) => String(segment)).join(':')
}

export async function storeEphemeralJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
) {
  const now = Date.now()
  const state = getShortLivedState()
  sweepExpiredEntries(state, now)

  const existing = state.ephemeral.get(key)
  if (existing && existing.expiresAt > now) return false
  if (existing) state.ephemeral.delete(key)

  assertCapacity(state, state.ephemeral, MAX_EPHEMERAL_ENTRIES, now)
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return false
  state.ephemeral.set(key, {
    serialized,
    expiresAt: now + Math.max(1, Math.trunc(ttlSeconds)) * 1000,
  })
  return true
}

export async function consumeEphemeralJson<T>(key: string): Promise<T | null> {
  const now = Date.now()
  const state = getShortLivedState()
  sweepExpiredEntries(state, now)

  const entry = state.ephemeral.get(key)
  state.ephemeral.delete(key)
  if (!entry || entry.expiresAt <= now) return null

  try {
    return JSON.parse(entry.serialized) as T
  } catch {
    return null
  }
}

export async function enforceRateLimit(options: {
  scope: string
  identity: string
  limit: number
  windowSeconds: number
}) {
  const now = Date.now()
  const state = getShortLivedState()
  sweepExpiredEntries(state, now)
  const key = shortLivedStateKey('rate', options.scope, options.identity)
  let entry = state.rateLimits.get(key)

  if (!entry || entry.expiresAt <= now) {
    if (entry) state.rateLimits.delete(key)
    assertCapacity(state, state.rateLimits, MAX_RATE_LIMIT_ENTRIES, now)
    entry = {
      count: 1,
      expiresAt: now + Math.max(1, Math.trunc(options.windowSeconds)) * 1000,
    }
    state.rateLimits.set(key, entry)
  } else {
    entry.count += 1
  }

  if (entry.count <= options.limit) return
  const retryAfter = Math.max(Math.ceil((entry.expiresAt - now) / 1000), 1)
  throw new HttpError('Too many requests', 429, 429, { retryAfter })
}

export function resetShortLivedStateForTests() {
  const state = getShortLivedState()
  state.ephemeral.clear()
  state.rateLimits.clear()
  state.nextSweepAt = 0
}
