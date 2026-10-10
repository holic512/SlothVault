/**
 * @file solana-evidence-instructions.ts
 * @project SlothVault
 * @module Evidence Transaction Instruction Policy
 * @description Defines explicit compute budgets and safe instruction summaries for wallet-signed Memo evidence.
 * @logic Prepare a fixed compute limit and zero priority fee before hashing, and summarize only known instruction types without exposing Memo data or accounts.
 * @dependencies @solana/web3.js
 * @index_tags evidence,solana,compute-budget,diagnostics
 * @author holic512
 */
import { ComputeBudgetInstruction, ComputeBudgetProgram, type TransactionInstruction } from '@solana/web3.js'

// UTF-8 Memo processing scales with its byte length. Use the transaction ceiling
// for this single-Memo shape, with zero unit price (no additional priority fee).
// Phantom's insertion conditions: https://docs.phantom.com/developer-powertools/solana-priority-fees
export const EVIDENCE_COMPUTE_UNIT_LIMIT = 1_400_000

export function evidenceComputeBudgetInstructions(units = EVIDENCE_COMPUTE_UNIT_LIMIT) {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
  ]
}

export function evidenceInstructionSummary(instructions: readonly TransactionInstruction[]) {
  return instructions.slice(0, 8).map((instruction) => {
    const program = instruction.programId.toBase58()
    if (program === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') return 'Memo'
    if (program === '11111111111111111111111111111111') return 'SystemProgram'
    if (instruction.programId.equals(ComputeBudgetProgram.programId)) {
      try {
        const type = ComputeBudgetInstruction.decodeInstructionType(instruction)
        if (type === 'SetComputeUnitLimit') {
          return `ComputeBudget.SetComputeUnitLimit(${ComputeBudgetInstruction.decodeSetComputeUnitLimit(instruction).units})`
        }
        if (type === 'SetComputeUnitPrice') {
          return `ComputeBudget.SetComputeUnitPrice(${ComputeBudgetInstruction.decodeSetComputeUnitPrice(instruction).microLamports})`
        }
        return `ComputeBudget.${type}`
      } catch { return 'ComputeBudget.Invalid' }
    }
    return 'OtherProgram'
  })
}
