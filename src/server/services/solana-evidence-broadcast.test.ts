import { afterEach, describe, expect, it, vi } from 'vitest'
import { SendTransactionError } from '@solana/web3.js'
import { classifyEvidenceBroadcastError, logEvidenceBroadcastError } from './solana-evidence-broadcast'

const memoProgram = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
const rejection = (message: string, logs?: string[]) => new SendTransactionError({ action: 'simulate', signature: '', transactionMessage: message, logs })
afterEach(() => vi.restoreAllMocks())

describe('safe evidence preflight failure classification', () => {
  it('identifies the observed Memo compute exhaustion without exposing raw RPC or Memo logs', () => {
    const logs = [`Program log: Memo (len 475): private memo`, `Program ${memoProgram} consumed 199700 of 199700 compute units`, `Program ${memoProgram} failed: exceeded CUs meter at BPF instruction`]
    const error = rejection('Transaction simulation failed: Error processing Instruction 2: Program failed to complete. private upstream https://rpc.invalid/?key=secret', logs)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(logEvidenceBroadcastError('broadcast.failed', error, { attemptId: 4 })).toMatchObject({
      definitive: true, reason: 'CHAIN_COMPUTE_BUDGET_EXCEEDED', instructionIndex: 2, programUnitsConsumed: 199700, programComputeUnitLimit: 199700,
    })
    const output = JSON.stringify(warning.mock.calls)
    expect(output).toContain('CHAIN_COMPUTE_BUDGET_EXCEEDED')
    expect(output).not.toMatch(/private memo|private upstream|rpc.invalid|secret|MemoSq4/)
  })
  it.each(['Blockhash not found', 'Too Many Requests', 'Node is unhealthy', 'Transaction already processed'])('preserves uncertain RPC responses: %s', message => {
    expect(classifyEvidenceBroadcastError(rejection(message))).toMatchObject({ definitive: false })
  })
  it('preserves a disconnected request and ignores budget keywords inside Memo content', () => {
    expect(classifyEvidenceBroadcastError(new TypeError('fetch failed'))).toMatchObject({ definitive: false })
    expect(classifyEvidenceBroadcastError(rejection('Node is unhealthy', ['Program log: Memo: exceeded CUs meter']))).toMatchObject({ definitive: false, reason: 'CHAIN_SUBMISSION_UNKNOWN' })
  })
  it.each(['insufficient funds for fee', 'Transaction results in an account (0) with insufficient funds for rent', 'Attempt to debit an account but found no record of a prior credit'])('classifies fee and rent failures: %s', message => {
    expect(classifyEvidenceBroadcastError(rejection(`Transaction simulation failed: ${message}`))).toMatchObject({ definitive: true, reason: 'EVIDENCE_BALANCE_INSUFFICIENT' })
  })
  it('retains the failed instruction index for other deterministic program failures', () => {
    expect(classifyEvidenceBroadcastError(rejection('Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1'))).toMatchObject({ definitive: true, reason: 'CHAIN_SUBMISSION_FAILED', instructionIndex: 2 })
    expect(classifyEvidenceBroadcastError(rejection('Transaction signature verification failure'))).toMatchObject({ definitive: true, reason: 'EVIDENCE_SIGNATURE_INVALID' })
  })
})
