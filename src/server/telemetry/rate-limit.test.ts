import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTelemetryLimitsForTests, telemetryRateLimit } from './rate-limit'
beforeEach(()=>resetTelemetryLimitsForTests())
afterEach(()=>vi.useRealTimers())
describe('isolated telemetry quota',()=>{
  it('rejects excess observations and expires independently of authentication state',()=>{
    vi.useFakeTimers();telemetryRateLimit('view:test',2);telemetryRateLimit('view:test',2)
    expect(()=>telemetryRateLimit('view:test',2)).toThrow('Too many telemetry observations')
    vi.advanceTimersByTime(60000);expect(()=>telemetryRateLimit('view:test',2)).not.toThrow()
  })
  it('has a fixed capacity and rejects ingestion, not unrelated business operations',()=>{
    for(let index=0;index<4096;index++)telemetryRateLimit(String(index),12)
    expect(()=>telemetryRateLimit('extra',12)).toThrow('Telemetry ingestion is busy')
  })
})
