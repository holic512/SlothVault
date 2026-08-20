import { describe, expect, it } from 'vitest'

import { Keypair } from '@solana/web3.js'

import {
  assertSignedNoteContentEvidenceTransaction,
  buildNoteContentEvidenceTransaction,
  buildNoteContentManifest,
  canonicalNoteContentEvidenceMemo,
  noteContentEvidenceMessageHash,
  parseSignedNoteContentEvidence,
} from '@/server/services/note-content-evidence-protocol'

const blockhash = '11111111111111111111111111111111'
const source = {
  releaseId: '90f98878-b654-4ad3-8f61-7b849ef03d49',
  projectVersion: 'v2.0',
  categoryName: '指南',
  noteTitle: '快速开始',
  versionNote: '初稿',
  isPrimary: true,
  status: 1,
  markdown: '# Hello\n',
}

describe('note content evidence protocol', () => {
  it('builds deterministic manifests without database identifiers', () => {
    const first = buildNoteContentManifest(source)
    const second = buildNoteContentManifest({ ...source })
    expect(second.hash).toBe(first.hash)
    expect(second.bytes.equals(first.bytes)).toBe(true)
    expect(JSON.stringify(first.manifest)).not.toMatch(/noteContentId|categoryId|noteInfoId/)
  })

  it('changes the hash when content or its published hierarchy changes', () => {
    const baseline = buildNoteContentManifest(source).hash
    expect(buildNoteContentManifest({ ...source, markdown: '# Changed\n' }).hash).not.toBe(baseline)
    expect(buildNoteContentManifest({ ...source, categoryName: 'Reference' }).hash).not.toBe(baseline)
    expect(buildNoteContentManifest({ ...source, noteTitle: 'Install' }).hash).not.toBe(baseline)
  })

  it('serializes Memo fields in the protocol order', () => {
    expect(canonicalNoteContentEvidenceMemo({
      installationId: '550e8400-e29b-41d4-a716-446655440000',
      contentEvidenceId: '61785fd5-b940-48ae-9300-06c05dd49686',
      releaseId: source.releaseId,
      manifestVersion: 1,
      contentHash: 'ab'.repeat(32),
      network: 'devnet',
      signer: '11111111111111111111111111111111',
    })).toBe('{"protocol":"slothvault.note-content","version":1,"installationId":"550e8400-e29b-41d4-a716-446655440000","contentEvidenceId":"61785fd5-b940-48ae-9300-06c05dd49686","releaseId":"90f98878-b654-4ad3-8f61-7b849ef03d49","manifestVersion":1,"contentHash":"abababababababababababababababababababababababababababababababab","network":"devnet","signer":"11111111111111111111111111111111"}')
  })

  it('accepts only the exact wallet-signed transaction', () => {
    const wallet = Keypair.generate()
    const memo = '{"protocol":"slothvault.note-content"}'
    const transaction = buildNoteContentEvidenceTransaction({
      memo,
      signer: wallet.publicKey,
      blockhash,
      lastValidBlockHeight: 123,
    })
    const messageHash = noteContentEvidenceMessageHash(transaction)
    transaction.sign(wallet)
    const parsed = parseSignedNoteContentEvidence(transaction.serialize().toString('base64'))
    expect(assertSignedNoteContentEvidenceTransaction({
      transaction: parsed,
      memo,
      signerAddress: wallet.publicKey.toBase58(),
      messageHash,
    })).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/)

    parsed.instructions[0].data = Buffer.from('tampered')
    expect(() => assertSignedNoteContentEvidenceTransaction({
      transaction: parsed,
      memo,
      signerAddress: wallet.publicKey.toBase58(),
      messageHash,
    })).toThrow('does not match')
  })
})
