import { describe, expect, it } from 'vitest'

import { Keypair } from '@solana/web3.js'

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
    expect(tx.instructions).toHaveLength(1)
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

    parsed.instructions[0].data = Buffer.from('tampered')
    expect(() => assertSignedProjectVersionEvidenceTransaction({
      transaction: parsed,
      memo,
      signerAddress: wallet.publicKey.toBase58(),
      messageHash,
    })).toThrow('does not match')
  })
})
