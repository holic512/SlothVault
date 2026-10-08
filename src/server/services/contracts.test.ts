import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  prisma: {
    contract: {
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    systemInstallation: { findFirst: vi.fn() },
    contractCredential: { findUnique: vi.fn() },
    contractCredentialAttempt: { findFirst: vi.fn() },
  },
  requireEnabledSolanaNetwork: vi.fn(),
}))

vi.mock('@/server/database/unit-of-work', () => ({
  unitOfWork: { execute: mocks.execute },
}))
vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/server/services/admin-files', () => ({ readManagedFile: vi.fn() }))
vi.mock('@/server/services/release-evidence-chain', () => ({
  evidenceRpcError: (error: unknown) => { throw error },
  finalizedEvidenceTransaction: vi.fn(),
  isEvidenceRpcConnectionFailure: vi.fn(),
  withEvidenceRpc: vi.fn(),
}))
vi.mock('@/server/services/system-config', () => ({
  getSolanaNetworkProfile: vi.fn(),
  requireEnabledSolanaNetwork: mocks.requireEnabledSolanaNetwork,
}))

import {
  CONTRACT_STATUS,
  createAdminContract,
  updateAdminContract,
  issueAdminContract,
  cancelAdminContract,
  readAuthorizedContractAttachment,
  getPublicContractEvidence,
  getUserContract,
  listUserContracts,
  prepareContractEvidence,
  signUserContract,
} from '@/server/services/contracts'
import { contractBodyHash } from '@/server/services/contract-evidence-protocol'

const issuedAt = new Date('2026-08-18T00:00:00.000Z')
const signedAt = new Date('2026-08-18T01:00:00.000Z')

function contractRecord(overrides: Record<string, unknown> = {}) {
  const body = 'Article one\n'
  return {
    id: 22,
    contractId: '2e5fbbb1-e44e-49d1-93e8-8783e16acaa1',
    installationId: '6ed9ce9d-0ec6-44d3-9ed1-94dcab18fb3f',
    issuerUserId: 1,
    subjectUserId: 7,
    title: 'Private service contract',
    body,
    bodyHash: contractBodyHash(body),
    contractHash: null,
    attachmentFileId: null,
    attachmentHash: null,
    partyCommitment: 'b'.repeat(64),
    status: CONTRACT_STATUS.PENDING_SIGNATURE,
    issuedAt,
    signedAt: null,
    signedSessionId: null,
    signedIp: null,
    signedUserAgent: null,
    declinedAt: null,
    declineReason: null,
    cancelledAt: null,
    createdAt: issuedAt,
    updatedAt: issuedAt,
    issuerUser: { username: 'admin', displayName: 'Admin' },
    subjectUser: { username: 'subject', displayName: 'Subject' },
    attachmentFile: null,
    credentials: [],
    adminAudits: [],
    ...overrides,
  }
}

describe('contract user boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not list an administrator draft in the designated user workspace', async () => {
    mocks.prisma.contract.count.mockResolvedValue(0)
    mocks.prisma.contract.findMany.mockResolvedValue([])

    await expect(listUserContracts(7, { page: 1, pageSize: 20 })).resolves.toMatchObject({ list: [] })

    expect(mocks.prisma.contract.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { subjectUserId: 7, status: { not: CONTRACT_STATUS.DRAFT }, issuedAt: { not: null } },
    }))
  })

  it('hides drafts and other users contracts with a not-found response', async () => {
    mocks.prisma.contract.findUnique
      .mockResolvedValueOnce(contractRecord({ status: CONTRACT_STATUS.DRAFT, issuedAt: null, installationId: null }))
      .mockResolvedValueOnce(contractRecord({ subjectUserId: 8 }))

    await expect(getUserContract(7, 22)).rejects.toMatchObject({ status: 404 })
    await expect(getUserContract(7, 22)).rejects.toMatchObject({ status: 404 })
  })

  it('binds the online signature to the pending state so a stale second request cannot overwrite it', async () => {
    const pending = contractRecord()
    const signed = contractRecord({
      status: CONTRACT_STATUS.SIGNED,
      signedAt,
      signedSessionId: '7b1c1642-7cec-41bd-ab53-9e7bf0622f45',
    })
    mocks.prisma.contract.findUnique.mockResolvedValueOnce(pending).mockResolvedValueOnce(signed)
    mocks.prisma.contract.updateMany.mockResolvedValue({ count: 1 })

    const result = await signUserContract({
      id: 22,
      userId: 7,
      sessionId: '7b1c1642-7cec-41bd-ab53-9e7bf0622f45',
      ip: '203.0.113.7',
      userAgent: 'contract-test',
    })

    expect(result).toMatchObject({ status: CONTRACT_STATUS.SIGNED })
    expect(result).not.toHaveProperty('signedAudit')

    expect(mocks.prisma.contract.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 22,
        subjectUserId: 7,
        status: CONTRACT_STATUS.PENDING_SIGNATURE,
      },
    }))
  })

  it('hides cancelled unissued drafts and their attachments from the recipient', async () => {
    mocks.prisma.contract.findUnique.mockResolvedValue(contractRecord({ status: -2, issuedAt: null }))
    await expect(getUserContract(7, 22)).rejects.toMatchObject({ status: 404 })
    await expect(readAuthorizedContractAttachment({ id: 22, userId: 7, isAdmin: false })).rejects.toMatchObject({ status: 404 })
  })

  it('atomically creates the frozen contract and both administrator audit records', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 7, role: 'USER', status: 1 })
    mocks.prisma.systemInstallation.findFirst.mockResolvedValue({ installationId: 'installation' })
    mocks.prisma.contract.create.mockResolvedValue(contractRecord())
    await createAdminContract({ issuerUserId: 1, subjectUserId: 7, title: 'Development', body: 'Scope and fees', issueImmediately: true })
    expect(mocks.prisma.contract.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      issuerUserId: 1, subjectUserId: 7, status: 1, installationId: 'installation', issuedAt: expect.any(Date),
      bodyHash: contractBodyHash('Scope and fees'),
      adminAudits: { create: [
        { actorUserId: 1, action: 'DRAFT_CREATED' },
        { actorUserId: 1, action: 'ISSUED' },
      ] },
    }) }))
  })

  it('does not create a partial contract when installation is missing or the recipient is disabled', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 7, role: 'USER', status: 1 })
    mocks.prisma.systemInstallation.findFirst.mockResolvedValue(null)
    await expect(createAdminContract({ issuerUserId: 1, subjectUserId: 7, title: 'Development', body: 'Terms', issueImmediately: true })).rejects.toMatchObject({ status: 409 })
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 7, role: 'USER', status: 0 })
    await expect(createAdminContract({ issuerUserId: 1, subjectUserId: 7, title: 'Development', body: 'Terms', issueImmediately: true })).rejects.toMatchObject({ status: 400 })
    expect(mocks.prisma.contract.create).not.toHaveBeenCalled()
  })

  it('rejects a stale draft edit and issuance rather than overwriting another state', async () => {
    mocks.prisma.contract.findUnique.mockResolvedValue(contractRecord({ status: 0 }))
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 7, role: 'USER', status: 1 })
    mocks.prisma.systemInstallation.findFirst.mockResolvedValue({ installationId: 'installation' })
    mocks.prisma.contract.update.mockRejectedValue({ code: 'P2025' })
    await expect(updateAdminContract({ id: 22, issuerUserId: 1, subjectUserId: 7, title: 'Changed', body: 'Changed' })).rejects.toMatchObject({ status: 409 })
    await expect(issueAdminContract({ id: 22, issuerUserId: 1 })).rejects.toMatchObject({ status: 409 })
    for (const [args] of mocks.prisma.contract.update.mock.calls) {
      expect(args.where).toEqual({ id: 22, status: 0, updatedAt: issuedAt })
    }
  })

  it('does not cancel a contract whose signature wins the race or record a cancellation audit', async () => {
    mocks.prisma.contract.findUnique.mockResolvedValue(contractRecord())
    const tx = { contract: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, contractAdminAudit: { create: vi.fn() } }
    mocks.execute.mockImplementation((callback) => callback(tx))
    await expect(cancelAdminContract({ id: 22, issuerUserId: 1 })).rejects.toMatchObject({ status: 409 })
    expect(tx.contract.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 22, status: 1, updatedAt: issuedAt } }))
    expect(tx.contractAdminAudit.create).not.toHaveBeenCalled()
  })

  it('only allows a signed contract to enter the chain-evidence state machine', async () => {
    mocks.requireEnabledSolanaNetwork.mockResolvedValue(undefined)
    mocks.prisma.contract.findUnique.mockResolvedValue(contractRecord())

    await expect(prepareContractEvidence({
      contractId: 22,
      issuerUserId: 1,
      network: 'devnet',
      signerAddress: '11111111111111111111111111111111',
    })).rejects.toMatchObject({ status: 409 })
  })

  it('returns only the public hash receipt fields without contract or participant content', async () => {
    mocks.prisma.contractCredential.findUnique.mockResolvedValue({
      id: 33,
      network: 'devnet',
      transactionSignature: '5'.repeat(88),
      status: 2,
      slot: 99n,
      blockTime: signedAt,
      feeLamports: 5_000n,
      finalizedAt: signedAt,
      lastVerifiedAt: signedAt,
      createdAt: issuedAt,
      contract: { contractHash: 'c'.repeat(64) },
    })

    const receipt = await getPublicContractEvidence('5'.repeat(88))

    expect(receipt).toEqual(expect.objectContaining({
      id: '33',
      contractHash: 'c'.repeat(64),
      network: 'devnet',
      transactionSignature: '5'.repeat(88),
    }))
    expect(receipt).not.toHaveProperty('memo')
    expect(receipt).not.toHaveProperty('signerAddress')
    expect(receipt).not.toHaveProperty('bodyHash')
    expect(receipt).not.toHaveProperty('attachmentHash')
    expect(receipt).not.toHaveProperty('contractId')
  })
})
