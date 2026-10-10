import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from './api-client'
import { EvidenceSubmissionCache, evidenceRequest } from './evidence-client'
import { isExpiredEvidenceAttempt } from './evidence-diagnostics'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('uncertain evidence submissions', () => {
  it('reuses the same signed payload after response loss without opening another wallet dialog', async () => {
    const cache = new EvidenceSubmissionCache(), sign = vi.fn(async () => 'same-signed-bytes')
    const first = await cache.payload('1', sign)
    expect(cache.settleError(new TypeError('fetch failed'))).toBe(false)
    expect(cache.settleError(new ApiClientError('RPC unavailable', 503, 503, null))).toBe(false)
    expect(await cache.payload('1', sign)).toBe(first)
    expect(sign).toHaveBeenCalledOnce()
    await expect(cache.payload('2', sign)).rejects.toThrow('still pending')
    cache.clear()
    expect(cache.pending).toBe(false)
  })
  it('retains bytes for generic conflicts and authentication failures, but clears explicit terminal failures', async () => {
    const cache = new EvidenceSubmissionCache()
    await cache.payload('1', async () => 'signed')
    expect(cache.settleError(new ApiClientError('Conflict', 409, 409, null))).toBe(false)
    expect(cache.settleError(new ApiClientError('Unauthenticated', 401, 401, null))).toBe(false)
    expect(cache.pending).toBe(true)
    expect(cache.settleError(new ApiClientError('Expired', 409, 409, { reason: 'EVIDENCE_PREPARE_EXPIRED' }))).toBe(true)
    expect(cache.pending).toBe(false)
  })
  it('does not cache rejected wallet requests', async () => {
    const cache = new EvidenceSubmissionCache()
    await expect(cache.payload('1', async () => { throw new Error('cancelled') })).rejects.toThrow('cancelled')
    expect(cache.pending).toBe(false)
  })
  it('clears signed bytes after a definitive compute rejection but preserves them for a missing blockhash', async () => {
    const cache = new EvidenceSubmissionCache()
    await cache.payload('1', async () => 'signed')
    expect(cache.settleError(new ApiClientError('Blockhash unavailable', 503, 503, { reason: 'CHAIN_BLOCKHASH_UNAVAILABLE' }))).toBe(false)
    expect(cache.pending).toBe(true)
    expect(cache.settleError(new ApiClientError('Compute budget exceeded', 400, 400, { reason: 'CHAIN_COMPUTE_BUDGET_EXCEEDED' }))).toBe(true)
    expect(cache.pending).toBe(false)
  })
  it('logs response reasons and status without bodies or raw upstream errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 409, message: 'secret upstream error', data: { reason: 'EVIDENCE_MESSAGE_MISMATCH' } }), { status: 409 })))
    await expect(evidenceRequest('/api/evidence', { signedTransactionBase64: 'private bytes', memo: 'private memo' }, { attemptId: '7', network: 'devnet' }, 'submit')).rejects.toMatchObject({ status: 409 })
    const logs = JSON.stringify(warn.mock.calls)
    expect(logs).toContain('EVIDENCE_MESSAGE_MISMATCH')
    expect(logs).toContain('409')
    expect(logs).not.toMatch(/private bytes|private memo|secret upstream/)
  })
  it('only displays unsigned prepared attempts as expired', () => {
    expect(isExpiredEvidenceAttempt({ status: 0, expiresAt: 10 }, 10)).toBe(true)
    expect(isExpiredEvidenceAttempt({ status: 'PREPARED', expiresAt: 11 }, 10)).toBe(false)
    expect(isExpiredEvidenceAttempt({ status: 1, expiresAt: 0 }, 10)).toBe(false)
    expect(isExpiredEvidenceAttempt({ status: 2, expiresAt: 0 }, 10)).toBe(false)
  })
})
