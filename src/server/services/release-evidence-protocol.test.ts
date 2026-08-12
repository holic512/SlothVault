import { describe, expect, it } from 'vitest'

import { Keypair, PublicKey } from '@solana/web3.js'

import {
  assertSignedEvidenceTransaction,
  buildEvidenceTransaction,
  canonicalEvidenceMemo,
  evidenceMessageHash,
  MEMO_PROGRAM_ID,
  parseSignedEvidence,
} from '@/server/services/release-evidence-protocol'

const blockhash = '11111111111111111111111111111111'

describe('release evidence Memo protocol', () => {
  it('serializes the protocol fields in one fixed compact order', () => {
    expect(canonicalEvidenceMemo({
      installationId: '550e8400-e29b-41d4-a716-446655440000',
      releaseId: '90f98878-b654-4ad3-8f61-7b849ef03d49',
      manifestVersion: 1,
      releaseHash: 'ab'.repeat(32),
      network: 'devnet',
      signer: '11111111111111111111111111111111',
    })).toBe('{"protocol":"slothvault.release","version":1,"installationId":"550e8400-e29b-41d4-a716-446655440000","releaseId":"90f98878-b654-4ad3-8f61-7b849ef03d49","manifestVersion":1,"releaseHash":"abababababababababababababababababababababababababababababababab","network":"devnet","signer":"11111111111111111111111111111111"}')
  })

  it('uses the wallet as fee payer and the only Memo signer', () => {
    const wallet = Keypair.generate()
    const transaction = buildEvidenceTransaction({
      memo: '{"test":true}',
      signer: wallet.publicKey,
      blockhash,
      lastValidBlockHeight: 123,
    })
    expect(transaction.feePayer?.equals(wallet.publicKey)).toBe(true)
    expect(transaction.instructions).toHaveLength(1)
    expect(transaction.instructions[0].programId.equals(MEMO_PROGRAM_ID)).toBe(true)
    expect(transaction.instructions[0].keys).toEqual([{ pubkey: wallet.publicKey, isSigner: true, isWritable: false }])
  })

  it('accepts the exact signed transaction and rejects message tampering', () => {
    const wallet = Keypair.generate()
    const memo = '{"protocol":"slothvault.release"}'
    const transaction = buildEvidenceTransaction({ memo, signer: wallet.publicKey, blockhash, lastValidBlockHeight: 123 })
    const messageHash = evidenceMessageHash(transaction)
    transaction.sign(wallet)
    const parsed = parseSignedEvidence(transaction.serialize().toString('base64'))
    expect(assertSignedEvidenceTransaction({
      transaction: parsed,
      memo,
      signerAddress: wallet.publicKey.toBase58(),
      messageHash,
    })).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/)

    parsed.instructions[0].data = Buffer.from('tampered')
    expect(() => assertSignedEvidenceTransaction({
      transaction: parsed,
      memo,
      signerAddress: wallet.publicKey.toBase58(),
      messageHash,
    })).toThrow('does not match')
  })

  it('rejects another fee payer or signer identity', () => {
    const wallet = Keypair.generate()
    const impostor = Keypair.generate()
    const transaction = buildEvidenceTransaction({ memo: '{}', signer: wallet.publicKey, blockhash, lastValidBlockHeight: 123 })
    transaction.sign(wallet)
    expect(() => assertSignedEvidenceTransaction({
      transaction,
      memo: '{}',
      signerAddress: impostor.publicKey.toBase58(),
      messageHash: evidenceMessageHash(transaction),
    })).toThrow('invalid evidence structure')
    expect(MEMO_PROGRAM_ID).toBeInstanceOf(PublicKey)
  })
})
