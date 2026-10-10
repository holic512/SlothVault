import { describe, expect, it } from 'vitest'

import { ComputeBudgetProgram, Keypair, SystemProgram } from '@solana/web3.js'
import { evidenceInstructionSummary } from '@/lib/solana-evidence-instructions'

import {
  assertSignedProjectVersionEvidenceTransaction,
  buildProjectVersionEvidenceTransaction,
  canonicalProjectVersionEvidenceMemo,
  projectVersionEvidenceMessageHash,
  parseSignedProjectVersionEvidence,
} from '@/server/services/project-version-evidence-protocol'

const blockhash = '11111111111111111111111111111111'
const manifest = { schema: 3 as const, projectName: 'Project', version: '1.0', contentHash: 'ab'.repeat(32) }

describe('project version evidence protocol', () => {
  it('includes only the compact snapshot in a deterministic Memo', () => {
    const input = { installationId: 'install', releaseId: 'release', manifest, releaseHash: 'cd'.repeat(32), network: 'devnet' as const, signer: '11111111111111111111111111111111' }
    const memo = canonicalProjectVersionEvidenceMemo(input)
    expect(memo).toBe(JSON.stringify({ protocol: 'slothvault.project-version', version: 1, ...input }))
    expect(JSON.parse(memo).manifest).toEqual(manifest)
    expect(memo).not.toMatch(/markdown|categories|notes|noteContentId/)
    const tx = buildProjectVersionEvidenceTransaction({ memo, signer: Keypair.generate().publicKey, blockhash, lastValidBlockHeight: 123 })
    expect(evidenceInstructionSummary(tx.instructions)).toEqual([
      'ComputeBudget.SetComputeUnitLimit(1400000)', 'ComputeBudget.SetComputeUnitPrice(0)', 'Memo',
    ])
    expect(tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length).toBeLessThanOrEqual(1232)
  })

  it('rejects oversized names without truncating or splitting the Memo', () => {
    const memo = canonicalProjectVersionEvidenceMemo({ installationId: 'install', releaseId: 'release', manifest: { ...manifest, projectName: '长名称'.repeat(500) }, releaseHash: 'cd'.repeat(32), network: 'devnet', signer: '11111111111111111111111111111111' })
    expect(() => buildProjectVersionEvidenceTransaction({ memo, signer: Keypair.generate().publicKey, blockhash, lastValidBlockHeight: 123 })).toThrow(expect.objectContaining({ status: 422, data: { reason: 'EVIDENCE_TOO_LARGE' } }))
  })

  it('accepts only the exact wallet-signed transaction', () => {
    const wallet = Keypair.generate()
    const memo = '{"protocol":"slothvault.project-version"}'
    const transaction = buildProjectVersionEvidenceTransaction({
      memo,
      signer: wallet.publicKey,
      blockhash,
      lastValidBlockHeight: 123,
    })
    const messageHash = projectVersionEvidenceMessageHash(transaction)
    transaction.sign(wallet)
    const parsed = parseSignedProjectVersionEvidence(transaction.serialize().toString('base64'))
    expect(assertSignedProjectVersionEvidenceTransaction({
      transaction: parsed,
      memo,
      signerAddress: wallet.publicKey.toBase58(),
      messageHash,
    })).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/)

    parsed.instructions[2].data = Buffer.from('tampered')
    expect(() => assertSignedProjectVersionEvidenceTransaction({
      transaction: parsed,
      memo,
      signerAddress: wallet.publicKey.toBase58(),
      messageHash,
    })).toThrow('does not match')
  })

  it('still verifies historical single-Memo attempts against their original hashes', () => {
    const wallet = Keypair.generate(), memo = 'historical evidence'
    const transaction = buildProjectVersionEvidenceTransaction({ memo, signer: wallet.publicKey, blockhash, lastValidBlockHeight: 123 })
    transaction.instructions = transaction.instructions.slice(2)
    const messageHash = projectVersionEvidenceMessageHash(transaction)
    transaction.sign(wallet)
    expect(assertSignedProjectVersionEvidenceTransaction({ transaction, memo, signerAddress: wallet.publicKey.toBase58(), messageHash })).toBeTruthy()
  })
  it('still verifies historical explicit 200,000-unit budgets against their original hashes', () => {
    const wallet = Keypair.generate(), memo = 'historical budgeted evidence'
    const transaction = buildProjectVersionEvidenceTransaction({ memo, signer: wallet.publicKey, blockhash, lastValidBlockHeight: 123 })
    transaction.instructions[0] = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })
    const messageHash = projectVersionEvidenceMessageHash(transaction)
    transaction.sign(wallet)
    expect(assertSignedProjectVersionEvidenceTransaction({ transaction, memo, signerAddress: wallet.publicKey.toBase58(), messageHash })).toBeTruthy()
  })

  it.each(['fee', 'limit', 'order', 'transfer', 'extraMemo'])('rejects an unauthorized %s instruction even when its hash and signature are valid', (change) => {
    const wallet = Keypair.generate(), memo = 'evidence'
    const transaction = buildProjectVersionEvidenceTransaction({ memo, signer: wallet.publicKey, blockhash, lastValidBlockHeight: 123 })
    if (change === 'fee') transaction.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })
    if (change === 'limit') transaction.instructions[0] = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })
    if (change === 'order') [transaction.instructions[0], transaction.instructions[1]] = [transaction.instructions[1], transaction.instructions[0]]
    if (change === 'transfer') transaction.add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }))
    if (change === 'extraMemo') transaction.add(transaction.instructions[2])
    const messageHash = projectVersionEvidenceMessageHash(transaction)
    transaction.sign(wallet)
    expect(() => assertSignedProjectVersionEvidenceTransaction({ transaction, memo, signerAddress: wallet.publicKey.toBase58(), messageHash })).toThrow(expect.objectContaining({ data: { reason: 'EVIDENCE_STRUCTURE_INVALID' } }))
  })
})
