/**
 * @file evidence-client.ts
 * @project SlothVault
 * @module Evidence Client Submission
 * @description Retains signed bytes for idempotent retries and records safe browser request outcomes.
 * @logic Sign once per attempt, retain the exact bytes until a known result, and clear them only on success or an explicit terminal failure.
 * @dependencies api-client, evidence-diagnostics
 * @index_tags evidence,wallet,retry,client,diagnostics
 * @author holic512
 */
import { apiFetch, ApiClientError } from '@/lib/api-client'
import { evidenceLog, evidenceReason, TERMINAL_EVIDENCE_REASONS } from '@/lib/evidence-diagnostics'

export async function evidenceRequest<T>(url: string, body: object, context: Parameters<typeof evidenceLog>[1], phase: string) {
  const started = performance.now()
  evidenceLog(`${phase}.request`, context)
  try {
    const result = await apiFetch<T>(url, { method: 'POST', body: JSON.stringify(body) })
    evidenceLog(`${phase}.response`, { ...context, elapsedMs: Math.round(performance.now() - started), httpStatus: 200 })
    return result
  } catch (error) {
    evidenceLog(`${phase}.response`, { ...context, elapsedMs: Math.round(performance.now() - started),
      httpStatus: error instanceof ApiClientError ? error.status : undefined, reason: evidenceReason(error) }, true)
    throw error
  }
}

export class EvidenceSubmissionCache {
  private signed: { attemptId: string; bytes: string } | null = null

  get pending() { return this.signed !== null }

  async payload(attemptId: string, sign: () => Promise<string>) {
    if (this.signed) {
      if (this.signed.attemptId !== attemptId) throw new Error('A signed evidence attempt is still pending')
      return this.signed.bytes
    }
    const bytes = await sign()
    this.signed = { attemptId, bytes }
    return bytes
  }

  clear() { this.signed = null }

  settleError(error: unknown) {
    const terminal = TERMINAL_EVIDENCE_REASONS.has(evidenceReason(error))
    if (terminal) this.clear()
    return terminal
  }
}
