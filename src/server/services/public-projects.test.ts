import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    project: { findFirst: vi.fn() },
    projectVersion: { findFirst: vi.fn() },
    noteInfo: { findFirst: vi.fn() },
    noteContent: { findMany: vi.fn() },
    releaseCredential: { findMany: vi.fn() },
    user: { findFirst: vi.fn() },
  },
}))

vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))

import { getProjectNote, getPublicProject } from '@/server/services/public-projects'

describe('public project reading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps a published project public even when a legacy row still requests auth', async () => {
    mocks.prisma.project.findFirst.mockResolvedValue({
      id: 4,
      projectName: 'Open archive',
      avatar: null,
      status: 1,
      requireAuth: true,
      updatedAt: new Date('2026-07-31T00:00:00.000Z'),
    })

    await expect(getPublicProject(4)).resolves.toMatchObject({
      id: '4',
      projectName: 'Open archive',
      requireAuth: false,
    })
  })

  it('returns finalized evidence shared by every article in a release', async () => {
    const updatedAt = new Date('2026-07-30T12:00:00.000Z')
    const issuedAt = new Date('2026-07-30T13:00:00.000Z')
    mocks.prisma.projectVersion.findFirst.mockResolvedValue({
      id: 8,
      projectId: 4,
      releaseId: '550e8400-e29b-41d4-a716-446655440000',
      releaseHash: 'a'.repeat(64),
      manifestVersion: 1,
      publishedAt: new Date('2026-07-30T11:00:00.000Z'),
      project: { isDeleted: false, status: 1 },
      releaseCredentials: [{
        network: 'devnet',
        transactionSignature: 'Signature1111111111111111111111111111111',
        signerAddress: 'Owner111111111111111111111111111111111111',
        finalizedAt: issuedAt,
      }],
    })
    mocks.prisma.project.findFirst.mockResolvedValue({
      id: 4,
      projectName: 'Open archive',
      avatar: null,
      status: 1,
      updatedAt,
    })
    mocks.prisma.noteInfo.findFirst.mockResolvedValue({
      id: 12,
      authorId: 3,
      noteTitle: 'A public essay',
    })
    mocks.prisma.noteContent.findMany.mockResolvedValue([{
      id: 18,
      content: '# Essay',
      versionNote: 'First edition',
      updatedAt,
    }])
    mocks.prisma.user.findFirst.mockResolvedValue({
      username: 'editor',
      displayName: 'Editor',
    })
    mocks.prisma.releaseCredential.findMany.mockResolvedValue([{
      network: 'mainnet',
      transactionSignature: 'ContentSignature111111111111111111111111111',
      signerAddress: 'Owner111111111111111111111111111111111111',
      subjectHash: 'b'.repeat(64),
      finalizedAt: issuedAt,
    }])
    const result = await getProjectNote(4, 8, 12)

    expect(result).toEqual({
      id: '18',
      noteId: '12',
      noteTitle: 'A public essay',
      content: '# Essay',
      versionNote: 'First edition',
      updatedAt,
      releaseId: '550e8400-e29b-41d4-a716-446655440000',
      releaseHash: 'a'.repeat(64),
      manifestVersion: 1,
      publishedAt: new Date('2026-07-30T11:00:00.000Z'),
      author: { username: 'editor', displayName: 'Editor' },
      evidence: [{
        transactionSignature: 'Signature1111111111111111111111111111111',
        signerAddress: 'Owner111111111111111111111111111111111111',
        network: 'devnet',
        finalizedAt: issuedAt,
      }],
      noteEvidence: [{
        transactionSignature: 'ContentSignature111111111111111111111111111',
        signerAddress: 'Owner111111111111111111111111111111111111',
        network: 'mainnet',
        contentHash: 'b'.repeat(64),
        finalizedAt: issuedAt,
      }],
    })
    expect(mocks.prisma.releaseCredential.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ noteContentId: 18, subjectType: 'NOTE_CONTENT' }),
    }))
  })
})
