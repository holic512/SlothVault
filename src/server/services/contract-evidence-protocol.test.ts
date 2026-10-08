import { describe, expect, it } from 'vitest'

import {
  canonicalContractEvidenceMemo,
  contractAttachmentHash,
  contractBodyHash,
  contractRootHash,
  normalizeContractBody,
  partyCommitment,
} from '@/server/services/contract-evidence-protocol'

describe('contract evidence protocol', () => {
  const contractId = '6ed9ce9d-0ec6-44d3-9ed1-94dcab18fb3f'
  const installationId = '20b94f9b-616f-49e3-ad5b-b2a8ff24b0c0'

  it('normalizes line endings before hashing the authoritative Markdown body', () => {
    expect(normalizeContractBody('第一条\r\n第二条\r\n\r\n')).toBe('第一条\n第二条\n')
    expect(contractBodyHash('第一条\r\n第二条\r\n')).toBe(contractBodyHash('第一条\n第二条\n'))
  })

  it('binds frozen body, binary attachment, party commitment, and signing time into one deterministic root hash', () => {
    const bodyHash = contractBodyHash('# 合同\n\n正文')
    const attachmentHash = contractAttachmentHash(Buffer.from('%PDF-1.7\ncontract'))
    const commitment = partyCommitment({ contractId, subjectUserId: 7, nonce: 'a'.repeat(64) })
    const snapshot = {
      installationId,
      contractId,
      title: '服务合同',
      bodyHash,
      attachmentHash,
      partyCommitment: commitment,
      issuedAt: new Date('2026-08-18T02:00:00.000Z'),
      signedAt: new Date('2026-08-18T02:01:00.000Z'),
    }
    expect(contractRootHash(snapshot)).toBe(contractRootHash(snapshot))
    expect(contractRootHash({ ...snapshot, signedAt: new Date('2026-08-18T02:02:00.000Z') }))
      .not.toBe(contractRootHash(snapshot))
  })

  it('keeps contract content, title, and participant identity out of the public Memo payload', () => {
    const memo = canonicalContractEvidenceMemo({
      installationId,
      contractId,
      contractHash: 'a'.repeat(64),
      bodyHash: 'b'.repeat(64),
      attachmentHash: 'c'.repeat(64),
      network: 'mainnet',
      signer: '11111111111111111111111111111111',
    })
    expect(memo).toContain('slothvault.contract')
    expect(memo).toContain('attachmentHash')
    expect(memo).not.toContain('服务合同')
    expect(memo).not.toContain('username')
    expect(memo).not.toContain('subjectUserId')
  })
  it('uses protocol v2 to bind the full template snapshot while preserving legacy v1 roots', () => {
    const input = { installationId, contractId, title: '委托协议', bodyHash: 'a'.repeat(64), attachmentHash: null, partyCommitment: 'b'.repeat(64), issuedAt: new Date('2026-10-08T01:00:00Z'), signedAt: new Date('2026-10-08T02:00:00Z') }
    const v1 = contractRootHash(input), v2 = contractRootHash({ ...input, snapshotHash: 'c'.repeat(64) })
    expect(v2).not.toBe(v1)
    expect(contractRootHash({ ...input, snapshotHash: null })).toBe(v1)
    expect(contractRootHash({ ...input, snapshotHash: 'd'.repeat(64) })).not.toBe(v2)
    const memo = JSON.parse(canonicalContractEvidenceMemo({ installationId, contractId, contractHash: v2, bodyHash: input.bodyHash, attachmentHash: null, network: 'devnet', signer: '11111111111111111111111111111111', snapshotHash: 'c'.repeat(64) }))
    expect(memo).toMatchObject({ version: 2, snapshotHash: 'c'.repeat(64), contractHash: v2 })
    expect(Object.keys(memo)).not.toContain('values')
  })
})
