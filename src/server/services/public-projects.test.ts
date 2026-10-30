import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    project: { findFirst: vi.fn() },
    projectHome: { findUnique: vi.fn() },
    projectMenu: { findMany: vi.fn() },
    projectVersion: { findFirst: vi.fn() },
    noteInfo: { findFirst: vi.fn() },
    noteContent: { findMany: vi.fn() },
    releaseCredential: { findMany: vi.fn() },
  },
}))

vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))

import {
  findPublicProjectHome,
  getProjectNote,
  getPublicProject,
  getProjectMenu,
} from '@/server/services/public-projects'

describe('public project reading', () => {
  it('returns raw parent and child menu icon choices without resolving automatic defaults', async () => {
    mocks.prisma.project.findFirst.mockResolvedValue({ id: 4, publicId: '10000000-0000-4000-8000-000000000004', updatedAt: new Date() })
    mocks.prisma.projectMenu.findMany.mockResolvedValue([{ id: 1, label: 'Parent', icon: null, url: null, isExternal: false, weight: 0,
      children: [{ id: 2, label: 'Child', icon: 'none', url: '/guide', isExternal: false, weight: 0 }] }])
    expect(await getProjectMenu(4)).toMatchObject([{ icon: null, children: [{ icon: 'none' }] }])
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps a published project public even when a legacy row still requests auth', async () => {
    mocks.prisma.project.findFirst.mockResolvedValue({
      id: 4, publicId: '10000000-0000-4000-8000-000000000004',
      projectName: 'Open archive',
      avatar: null,
      status: 1,
      requireAuth: true,
      updatedAt: new Date('2026-07-31T00:00:00.000Z'),
    })

    await expect(getPublicProject(4)).resolves.toMatchObject({
      id: '10000000-0000-4000-8000-000000000004',
      projectName: 'Open archive',
      requireAuth: false,
    })
  })

  it('treats a missing homepage as an optional public entry point', async () => {
    mocks.prisma.project.findFirst.mockResolvedValue({
      id: 4, publicId: '10000000-0000-4000-8000-000000000004',
      projectName: 'Open archive',
      avatar: null,
      status: 1,
      updatedAt: new Date('2026-07-31T00:00:00.000Z'),
    })
    mocks.prisma.projectHome.findUnique.mockResolvedValue(null)

    await expect(findPublicProjectHome(4)).resolves.toBeNull()
    expect(mocks.prisma.projectHome.findUnique).toHaveBeenCalledWith({ where: { projectId: 4 } })
  })

  it('returns note content without retired per-note evidence or version credential fields', async () => {
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
      id: 4, publicId: '10000000-0000-4000-8000-000000000004',
      projectName: 'Open archive',
      avatar: null,
      status: 1,
      updatedAt,
    })
    mocks.prisma.noteInfo.findFirst.mockResolvedValue({
      id: 12, publicId: '10000000-0000-4000-8000-000000000012',
      noteTitle: 'A public essay',
    })
    mocks.prisma.noteContent.findMany.mockResolvedValue([{
      id: 18,
      content: '# Essay',
      versionNote: 'First edition',
      updatedAt,
    }])
    mocks.prisma.releaseCredential.findMany.mockResolvedValue([{
      network: 'mainnet',
      transactionSignature: 'ContentSignature111111111111111111111111111',
      signerAddress: 'Owner111111111111111111111111111111111111',
      subjectHash: 'b'.repeat(64),
      finalizedAt: issuedAt,
    }])
    const result = await getProjectNote(4, 8, 12)

    expect(result).toEqual({
      noteId: '10000000-0000-4000-8000-000000000012',
      noteTitle: 'A public essay',
      tags: [],
      content: '# Essay',
      versionNote: 'First edition',
      updatedAt,
    })
    expect(mocks.prisma.releaseCredential.findMany).not.toHaveBeenCalled()
  })
})
