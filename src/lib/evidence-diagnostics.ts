/**
 * @file evidence-diagnostics.ts
 * @project SlothVault
 * @module Evidence Diagnostics
 * @description Shares safe phase logs and stable evidence failure codes across wallet and server boundaries.
 * @logic Emit only explicitly selected metadata, never arbitrary errors or transaction payloads, and identify failures by machine-readable reasons.
 * @dependencies none
 * @index_tags evidence,diagnostics,privacy,errors
 * @author holic512
 */
export type EvidenceNetwork = 'mainnet' | 'devnet'

export class EvidenceSigningError extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'EvidenceSigningError'
  }
}

export function evidenceReason(error: unknown): string {
  if (error instanceof EvidenceSigningError) return error.reason
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = error.data
    if (typeof data === 'object' && data !== null && 'reason' in data && typeof data.reason === 'string') {
      return /^[A-Z][A-Z0-9_]{0,79}$/.test(data.reason) ? data.reason : 'EVIDENCE_UNKNOWN_ERROR'
    }
  }
  return 'EVIDENCE_UNKNOWN_ERROR'
}

type EvidenceLogFields = {
  attemptId?: string | number
  credentialId?: string | number
  network?: string
  walletName?: string | null
  elapsedMs?: number
  httpStatus?: number
  reason?: string
  status?: string | number
  transactionSignature?: string | null
  expectedMessageHash?: string
  actualMessageHash?: string
  blockhashChanged?: boolean
  feePayerChanged?: boolean
  instructionCountChanged?: boolean
  expectedInstructionCount?: number
  actualInstructionCount?: number
  expectedInstructions?: string[]
  actualInstructions?: string[]
  signaturePresent?: boolean
  signatureValid?: boolean
  rpcUnavailable?: boolean
  instructionIndex?: number
  programUnitsConsumed?: number
  programComputeUnitLimit?: number
}

export function evidenceLog(phase: string, fields: EvidenceLogFields = {}, failed = false) {
  // Never spread an Error, provider response, request body, or prepared transaction here.
  const record = { phase, ...fields }
  if (failed) console.warn('[evidence]', record)
  else console.info('[evidence]', record)
}

export function isExpiredEvidenceAttempt(attempt: { status: number | string; expiresAt: string | number }, now = Date.now()) {
  return (attempt.status === 0 || attempt.status === 'PREPARED') && new Date(attempt.expiresAt).getTime() <= now
}

export const TERMINAL_EVIDENCE_REASONS = new Set([
  'EVIDENCE_MESSAGE_MISMATCH', 'EVIDENCE_SIGNATURE_INVALID', 'EVIDENCE_TRANSACTION_INVALID',
  'EVIDENCE_STRUCTURE_INVALID', 'EVIDENCE_PREPARE_EXPIRED', 'PREPARE_EXPIRED',
  'EVIDENCE_ATTEMPT_STALE', 'EVIDENCE_ATTEMPT_FAILED', 'EVIDENCE_ALREADY_FINALIZED',
  'EVIDENCE_ALREADY_SUBMITTED', 'RELEASE_INTEGRITY_FAILED', 'CHAIN_SUBMISSION_FAILED',
  'CHAIN_COMPUTE_BUDGET_EXCEEDED', 'EVIDENCE_BALANCE_INSUFFICIENT',
])
