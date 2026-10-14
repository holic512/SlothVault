/**
 * @file rate-limit.ts
 * @project SlothVault
 * @module Telemetry Ingestion Quota
 * @description Bounds public ingestion without consuming authentication rate-limit capacity.
 * @logic Keep expiring, privacy-safe counters in a separate fixed-size map and reject excess observations without retaining business identities.
 * @dependencies HTTP domain errors
 * @index_tags telemetry,rate-limit,privacy,fault-isolation
 * @author holic512
 */
import 'server-only'
import { HttpError } from '@/server/http/errors'
const MAXIMUM_IDENTITIES = 4096
const WINDOW_MS = 60_000
const globalLimits = globalThis as unknown as { slothVaultTelemetryLimits?: Map<string, { expiresAt: number; count: number }> }
export function telemetryRateLimit(identity: string, maximum: number) {
  const limits = globalLimits.slothVaultTelemetryLimits ??= new Map()
  const now = Date.now()
  let entry = limits.get(identity)
  if (entry && entry.expiresAt <= now) { limits.delete(identity); entry = undefined }
  if (!entry) {
    if (limits.size >= MAXIMUM_IDENTITIES) {
      for (const [key, value] of limits) if (value.expiresAt <= now) limits.delete(key)
      if (limits.size >= MAXIMUM_IDENTITIES) throw new HttpError('Telemetry ingestion is busy', 429, 429)
    }
    entry = { expiresAt: now + WINDOW_MS, count: 0 }
    limits.set(identity, entry)
  }
  entry.count += 1
  if (entry.count > maximum) throw new HttpError('Too many telemetry observations', 429, 429)
}
export function resetTelemetryLimitsForTests() { globalLimits.slothVaultTelemetryLimits?.clear() }
