import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  noteInfoFindFirst: vi.fn(),
  noteInfoUpdateMany: vi.fn(),
  noteContentFindMany: vi.fn(),
  noteContentFindUnique: vi.fn(),
  noteContentFindUniqueOrThrow: vi.fn(),
  noteContentUpdate: vi.fn(),
  noteContentUpdateMany: vi.fn(),
  executeVersionWrite: vi.fn(),
  lockDraftProjectVersions: vi.fn(),
  projectVersionIdForNote: vi.fn(),
}))

const tx = {
  noteInfo: {
    findFirst: mocks.noteInfoFindFirst,
    updateMany: mocks.noteInfoUpdateMany,
  },
  noteContent: {
    findMany: mocks.noteContentFindMany,
    findUnique: mocks.noteContentFindUnique,
    findUniqueOrThrow: mocks.noteContentFindUniqueOrThrow,
    update: mocks.noteContentUpdate,
    updateMany: mocks.noteContentUpdateMany,
  },
}

vi.mock('@/server/prisma', () => ({
  prisma: {
    noteInfo: { findFirst: mocks.noteInfoFindFirst },
    noteContent: {
      findMany: mocks.noteContentFindMany,
      findUnique: mocks.noteContentFindUnique,
    },
  },
}))

vi.mock('@/server/services/project-version-release', () => ({
  executeVersionWrite: mocks.executeVersionWrite,
  lockDraftProjectVersions: mocks.lockDraftProjectVersions,
  projectVersionIdForCategory: vi.fn(),
  projectVersionIdForNote: mocks.projectVersionIdForNote,
}))

import {
  getAdminNoteContent,
  listAdminNoteContentVersions,
  updateAdminNoteContent,
} from '@/server/services/admin-notes'

const timestamp = new Date('2026-09-14T00:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.executeVersionWrite.mockImplementation(async (operation) => operation(tx))
  mocks.projectVersionIdForNote.mockResolvedValue(11)
})

describe('MCP note content service contracts', () => {
  it('lists lightweight version metadata without selecting Markdown content', async () => {
    mocks.noteInfoFindFirst.mockResolvedValue({ id: 31 })
    mocks.noteContentFindMany.mockResolvedValue([{
      id: 41,
      noteInfoId: 31,
      versionNote: 'draft',
      isPrimary: true,
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      isDeleted: false,
    }])

    const result = await listAdminNoteContentVersions(31)
    expect(result.list[0]).not.toHaveProperty('content')
    expect(mocks.noteContentFindMany).toHaveBeenCalledWith({
      where: { noteInfoId: 31, isDeleted: false },
      select: {
        id: true,
        noteInfoId: true,
        versionNote: true,
        isPrimary: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        isDeleted: true,
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    })
  })

  it('returns full Markdown only from the explicit content lookup', async () => {
    mocks.noteContentFindUnique.mockResolvedValue({
      id: 41,
      noteInfoId: 31,
      content: '# Draft',
      versionNote: null,
      isPrimary: true,
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      isDeleted: false,
    })

    await expect(getAdminNoteContent(41)).resolves.toMatchObject({
      id: '41',
      noteInfoId: '31',
      content: '# Draft',
    })
  })

  it('sets one undeleted content primary while demoting the previous primary under the draft lock', async () => {
    const current = {
      id: 41,
      noteInfoId: 31,
      content: '# New',
      versionNote: null,
      isPrimary: false,
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      isDeleted: false,
    }
    mocks.noteContentFindUnique
      .mockResolvedValueOnce({ noteInfoId: 31 })
      .mockResolvedValueOnce(current)
    mocks.noteInfoUpdateMany.mockResolvedValue({ count: 1 })
    mocks.noteInfoFindFirst.mockResolvedValue({ id: 31 })
    mocks.noteContentFindMany.mockResolvedValue([
      { id: 42, isPrimary: true, updatedAt: timestamp, createdAt: timestamp },
      { id: 41, isPrimary: false, updatedAt: timestamp, createdAt: timestamp },
    ])
    mocks.noteContentFindUniqueOrThrow.mockResolvedValue({ ...current, isPrimary: true })

    await expect(updateAdminNoteContent(41, { isPrimary: true })).resolves.toMatchObject({
      id: '41',
      isPrimary: true,
    })
    expect(mocks.lockDraftProjectVersions).toHaveBeenCalledWith(tx, [11])
    expect(mocks.noteContentUpdateMany).toHaveBeenCalledWith({
      where: { noteInfoId: 31, isPrimary: true, id: { not: 41 } },
      data: { isPrimary: false, updatedAt: expect.any(Date) },
    })
    expect(mocks.noteContentUpdate).toHaveBeenCalledWith({
      where: { id: 41 },
      data: { isPrimary: true, updatedAt: expect.any(Date) },
    })
  })
})
