import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  invalidatePublicProjectCache: vi.fn(),
}))

vi.mock('@/server/prisma', () => ({
  prisma: {
    project: {
      updateMany: mocks.updateMany,
      findUnique: mocks.findUnique,
    },
  },
}))

vi.mock('@/server/services/public-project-cache', () => ({
  invalidatePublicProjectCache: mocks.invalidatePublicProjectCache,
}))

import { updateAdminProjectMetadataFromMcp } from '@/server/services/admin-catalog/projects'

const timestamp = new Date('2026-09-14T00:00:00.000Z')

function project() {
  return {
    id: 9,
    projectName: 'Documentation',
    avatar: null,
    weight: 8,
    status: 1,
    requireAuth: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    isDeleted: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MCP project metadata boundary', () => {
  it('allows weight-only updates without requiring the project to be unpublished', async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 })
    mocks.findUnique.mockResolvedValue(project())

    await expect(updateAdminProjectMetadataFromMcp(9, { weight: 8 })).resolves.toMatchObject({
      id: '9',
      weight: 8,
    })
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 9, isDeleted: false },
      data: { weight: 8, updatedAt: expect.any(Date) },
    })
    expect(mocks.invalidatePublicProjectCache).toHaveBeenCalledWith(9)
  })

  it('atomically limits name and avatar changes to projects without releases', async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 })
    mocks.findUnique.mockResolvedValue(project())

    await updateAdminProjectMetadataFromMcp(9, {
      projectName: 'Documentation 2',
      avatar: null,
      weight: 7,
    })
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: 9,
        isDeleted: false,
        versions: { none: { publishedAt: { not: null } } },
      },
      data: {
        projectName: 'Documentation 2',
        avatar: null,
        weight: 7,
        updatedAt: expect.any(Date),
      },
    })
  })

  it('rejects a mixed metadata update as a whole after any version is published', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 })
    mocks.findUnique.mockResolvedValue({
      isDeleted: false,
      versions: [{ id: 11 }],
    })

    await expect(updateAdminProjectMetadataFromMcp(9, {
      projectName: 'Forbidden rename',
      weight: 99,
    })).rejects.toMatchObject({
      status: 409,
      data: { reason: 'PROJECT_METADATA_LIVE', projectId: '9' },
    })
    expect(mocks.invalidatePublicProjectCache).not.toHaveBeenCalled()
  })
})
