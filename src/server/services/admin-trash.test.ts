import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tx = {
    project: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    projectVersion: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    category: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    noteInfo: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    noteContent: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    projectMenu: { updateMany: vi.fn(), findUnique: vi.fn() },
    projectHome: { updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  }
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      article: { updateMany: vi.fn() },
    },
    invalidateProject: vi.fn(),
    invalidateArticle: vi.fn(),
    lock: vi.fn(),
  }
})

vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/server/services/public-project-cache', () => ({ invalidatePublicProjectCache: mocks.invalidateProject }))
vi.mock('@/server/services/public-article-cache', () => ({ invalidatePublicArticleCache: mocks.invalidateArticle }))
vi.mock('@/server/services/project-version-release', () => ({
  executeVersionWrite: async (callback: (client: typeof mocks.tx) => unknown) => callback(mocks.tx),
  lockDraftProjectVersions: mocks.lock,
}))

import { deleteProjectBatch, deleteTrashItem, restoreTrashItem } from './admin-trash'

describe('content trash transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tx.project.findUnique.mockResolvedValue({ isDeleted: false })
    mocks.tx.projectVersion.findMany.mockResolvedValue([{ id: 11 }])
    mocks.tx.projectVersion.updateMany.mockResolvedValue({ count: 1 })
    mocks.tx.category.findMany.mockResolvedValue([{ id: 21 }])
    mocks.tx.noteInfo.findMany.mockResolvedValue([{ id: 31 }])
    mocks.tx.project.updateMany.mockResolvedValue({ count: 1 })
  })

  it('cascades a project deletion through draft descendants but never fetches released versions for mutation', async () => {
    await deleteTrashItem('project', 7)

    expect(mocks.tx.projectVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: 7, publishedAt: null } }))
    expect(mocks.tx.noteContent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { noteInfoId: { in: [31] }, isDeleted: false },
      data: expect.objectContaining({ isDeleted: true, deletedAt: expect.any(Date), isPrimary: false }),
    }))
    expect(mocks.tx.projectVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: [11] }, isDeleted: false },
      data: expect.objectContaining({ isDeleted: true, deletedAt: expect.any(Date) }),
    }))
    expect(mocks.tx.projectMenu.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: 7, isDeleted: false } }))
    expect(mocks.tx.projectHome.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: 7, isDeleted: false } }))
    expect(mocks.invalidateProject).toHaveBeenCalledWith(7)
  })

  it('shares one deletion timestamp across all projects in a batch', async () => {
    await deleteProjectBatch([7, 8])
    const first = mocks.tx.project.update.mock.calls[0][0].data.deletedAt
    const second = mocks.tx.project.update.mock.calls[1][0].data.deletedAt
    expect(first).toBe(second)
    expect(mocks.invalidateProject).toHaveBeenCalledTimes(2)
  })

  it('restores a project without restoring its children, and immediately re-enables it', async () => {
    await restoreTrashItem('project', 7)
    expect(mocks.tx.project.updateMany).toHaveBeenCalledWith({
      where: { id: 7, isDeleted: true },
      data: { isDeleted: false, deletedAt: null, status: 1, updatedAt: expect.any(Date) },
    })
    expect(mocks.tx.projectVersion.updateMany).not.toHaveBeenCalled()
    expect(mocks.tx.category.updateMany).not.toHaveBeenCalled()
  })

  it('restores a content revision with its ancestors, but not sibling revisions', async () => {
    mocks.tx.noteContent.findUnique.mockResolvedValue({ isDeleted: true, noteInfoId: 31 })
    mocks.tx.noteInfo.findUnique.mockResolvedValue({ categoryId: 21 })
    mocks.tx.category.findUnique.mockResolvedValue({ projectVersionId: 11 })
    mocks.tx.projectVersion.findUnique.mockResolvedValue({ projectId: 7, publishedAt: null })
    mocks.tx.noteContent.findFirst.mockResolvedValue(null)

    await restoreTrashItem('content', 41)

    expect(mocks.tx.project.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7, isDeleted: true } }))
    expect(mocks.tx.projectVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 11, isDeleted: true } }))
    expect(mocks.tx.category.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 21, isDeleted: true } }))
    expect(mocks.tx.noteInfo.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 31, isDeleted: true } }))
    expect(mocks.tx.noteContent.update).toHaveBeenCalledWith({ where: { id: 41 }, data: { isDeleted: false, deletedAt: null, updatedAt: expect.any(Date) } })
    expect(mocks.tx.noteContent.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 42 } }))
    expect(mocks.tx.noteContent.update).toHaveBeenCalledWith({ where: { id: 41 }, data: { isPrimary: true } })
  })

  it('refuses frozen releases before restoring any ancestor', async () => {
    mocks.tx.projectVersion.findUnique.mockResolvedValue({ isDeleted: true, projectId: 7, publishedAt: new Date() })
    await expect(restoreTrashItem('version', 11)).rejects.toMatchObject({ status: 409 })
    expect(mocks.tx.project.updateMany).not.toHaveBeenCalled()
    expect(mocks.tx.projectVersion.updateMany).not.toHaveBeenCalled()
  })

  it('restores deleted ancestors of a historically active child without changing its content', async () => {
    mocks.tx.noteContent.findUnique.mockResolvedValue({ isDeleted: false, noteInfoId: 31 })
    mocks.tx.noteInfo.findUnique.mockResolvedValue({ categoryId: 21, isDeleted: false })
    mocks.tx.category.findUnique.mockResolvedValue({ projectVersionId: 11, isDeleted: true })
    mocks.tx.projectVersion.findUnique.mockResolvedValue({ projectId: 7, isDeleted: false, publishedAt: null })

    await restoreTrashItem('content', 41)

    expect(mocks.tx.project.updateMany).toHaveBeenCalledOnce()
    expect(mocks.tx.category.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 21, isDeleted: true } }))
    expect(mocks.tx.noteContent.update).not.toHaveBeenCalled()
  })

  it('does not complete project deletion after a version write conflict', async () => {
    mocks.tx.projectVersion.updateMany.mockResolvedValue({ count: 0 })
    mocks.tx.projectVersion.findUnique.mockResolvedValue({ publishedAt: new Date() })
    await expect(deleteTrashItem('project', 7)).rejects.toMatchObject({ status: 409 })
    expect(mocks.tx.project.update).not.toHaveBeenCalled()
    expect(mocks.invalidateProject).not.toHaveBeenCalled()
  })
})
