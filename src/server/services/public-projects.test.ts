import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    project: { findFirst: vi.fn() },
    projectVersion: { findFirst: vi.fn() },
    noteInfo: { findFirst: vi.fn() },
    noteContent: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    compressedNft: { findFirst: vi.fn() },
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

  it('returns only matching author-bound copyright evidence with an article', async () => {
    const updatedAt = new Date('2026-07-30T12:00:00.000Z')
    const issuedAt = new Date('2026-07-30T13:00:00.000Z')
    mocks.prisma.projectVersion.findFirst.mockResolvedValue({
      id: 8,
      projectId: 4,
      project: { isDeleted: false, status: 1 },
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
    mocks.prisma.noteContent.findFirst.mockResolvedValue({
      id: 18,
      content: '# Essay',
      versionNote: 'First edition',
      updatedAt,
    })
    mocks.prisma.user.findFirst.mockResolvedValue({
      username: 'editor',
      displayName: 'Editor',
    })
    mocks.prisma.compressedNft.findFirst.mockResolvedValue({
      assetId: 'Asset111111111111111111111111111111111111',
      mintTxSignature: 'Signature1111111111111111111111111111111',
      ownerAddress: 'Owner111111111111111111111111111111111111',
      createdAt: issuedAt,
      merkleTree: { network: 'devnet' },
    })

    const result = await getProjectNote(4, 8, 12)

    expect(mocks.prisma.compressedNft.findFirst).toHaveBeenCalledWith({
      where: {
        noteInfoId: 12,
        copyrightOwnerId: 3,
        status: 1,
      },
      orderBy: { createdAt: 'desc' },
      select: expect.any(Object),
    })
    expect(result).toEqual({
      id: '18',
      noteId: '12',
      noteTitle: 'A public essay',
      content: '# Essay',
      versionNote: 'First edition',
      updatedAt,
      author: { username: 'editor', displayName: 'Editor' },
      certificate: {
        assetId: 'Asset111111111111111111111111111111111111',
        transaction: 'Signature1111111111111111111111111111111',
        ownerAddress: 'Owner111111111111111111111111111111111111',
        network: 'devnet',
        issuedAt,
      },
    })
  })
})
