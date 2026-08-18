import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    contract: { findFirst: vi.fn(), findUnique: vi.fn() },
    fileManagement: { update: vi.fn(), updateMany: vi.fn() },
  },
}))

vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))

import {
  batchSoftDelete,
  inspectPublicUpload,
  softDeleteFile,
} from '@/server/services/admin-files'

describe('contract attachment storage boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not allow a linked contract attachment to be soft-deleted', async () => {
    mocks.prisma.contract.findUnique.mockResolvedValue({ contractId: '9d72f231-8f01-41f1-b69a-e25755a08275' })

    await expect(softDeleteFile(41)).rejects.toMatchObject({ status: 409 })
    expect(mocks.prisma.fileManagement.update).not.toHaveBeenCalled()
  })

  it('does not allow a linked contract attachment to be included in a batch deletion', async () => {
    mocks.prisma.contract.findFirst.mockResolvedValue({ contractId: '9d72f231-8f01-41f1-b69a-e25755a08275' })

    await expect(batchSoftDelete([41, 42])).rejects.toMatchObject({ status: 409 })
    expect(mocks.prisma.fileManagement.updateMany).not.toHaveBeenCalled()
  })

  it('refuses the private attachment directory through the public uploads route', async () => {
    await expect(inspectPublicUpload(['contract-attachment', 'agreement.pdf']))
      .rejects.toMatchObject({ status: 403 })
  })
})
