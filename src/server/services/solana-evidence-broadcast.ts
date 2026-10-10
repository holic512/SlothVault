/**
 * @file solana-evidence-broadcast.ts
 * @project SlothVault
 * @module Evidence Broadcast Failure Boundary
 * @description Converts RPC preflight failures into safe, actionable evidence reasons.
 * @logic Identify deterministic preflight rejections, retain uncertain submissions for reconciliation, and log only classified errors and numeric program metrics.
 * @dependencies @solana/web3.js, evidence-diagnostics
 * @index_tags evidence,solana,rpc,preflight,privacy,retry
 * @author holic512
 */
import 'server-only'
import { SendTransactionError } from '@solana/web3.js'
import { evidenceLog } from '@/lib/evidence-diagnostics'

type EvidenceBroadcastFailure = {
  definitive: boolean
  reason: string
  message: string
  instructionIndex?: number
  programUnitsConsumed?: number
  programComputeUnitLimit?: number
}

export function classifyEvidenceBroadcastError(error: unknown): EvidenceBroadcastFailure {
  const unknown = { definitive: false, reason: 'CHAIN_SUBMISSION_UNKNOWN', message: 'Broadcast result is unknown; reconcile the original transaction signature' }
  if (!(error instanceof SendTransactionError)) return unknown
  // Never log error.message or raw program logs: Memo output contains the payload.
  const { message, logs } = error.transactionError
  const text = [message, ...(logs ?? []).filter(line => /^Program \S+ failed:/.test(line))].join('\n')
  const instruction = message.match(/Instruction (\d+)/i)
  const consumed = logs?.map(line => line.match(/^Program \S+ consumed (\d+) of (\d+) compute units$/)).findLast(match => match !== null)
  const metrics = {
    instructionIndex: instruction ? Number(instruction[1]) : undefined,
    programUnitsConsumed: consumed ? Number(consumed[1]) : undefined,
    programComputeUnitLimit: consumed ? Number(consumed[2]) : undefined,
  }
  if (/blockhash not found/i.test(message)) {
    // A lagging node can also lack a live blockhash. Reconcile before declaring expiry.
    return { ...unknown, ...metrics, reason: 'CHAIN_BLOCKHASH_UNAVAILABLE' }
  }
  if (/exceeded CUs meter|computational budget exceeded|ComputationalBudgetExceeded/i.test(text)) {
    return { ...metrics, definitive: true, reason: 'CHAIN_COMPUTE_BUDGET_EXCEEDED', message: 'Memo execution exceeded the transaction compute budget; prepare a new transaction' }
  }
  if (/insufficient funds for (?:fee|rent)|insufficient lamports|Attempt to debit an account but found no record of a prior credit/i.test(message)) {
    return { ...metrics, definitive: true, reason: 'EVIDENCE_BALANCE_INSUFFICIENT', message: 'The signing wallet has insufficient SOL for the transaction fee or rent' }
  }
  if (/Transaction signature verification failure/i.test(message)) {
    return { ...metrics, definitive: true, reason: 'EVIDENCE_SIGNATURE_INVALID', message: 'RPC rejected the transaction signature' }
  }
  if (/Transaction simulation failed/i.test(message) && instruction) {
    return { ...metrics, definitive: true, reason: 'CHAIN_SUBMISSION_FAILED', message: `Transaction preflight rejected instruction ${Number(instruction[1])}` }
  }
  return { ...unknown, ...metrics }
}

export function logEvidenceBroadcastError(phase: string, error: unknown, context: Parameters<typeof evidenceLog>[1]) {
  const failure = classifyEvidenceBroadcastError(error)
  evidenceLog(phase, { ...context, reason: failure.reason,
    instructionIndex: failure.instructionIndex,
    programUnitsConsumed: failure.programUnitsConsumed, programComputeUnitLimit: failure.programComputeUnitLimit,
  }, true)
  return failure
}
