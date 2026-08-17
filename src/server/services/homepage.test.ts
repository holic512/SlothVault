import type { AppPrismaClient } from '@/server/database/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    systemHomepage: { findFirst: vi.fn() },
  },
}))

vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))

import {
  ensureInitialHomepage,
  getHomepageContent,
} from '@/server/services/homepage'

describe('system homepage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates one enabled editable homepage when the database has none', async () => {
    const findFirst = vi.fn().mockResolvedValue(null)
    const create = vi.fn().mockResolvedValue({ id: 1 })
    const client = {
      systemHomepage: { findFirst, create },
    } as unknown as Pick<AppPrismaClient, 'systemHomepage'>

    await expect(ensureInitialHomepage(client)).resolves.toBe(true)
    expect(findFirst).toHaveBeenCalledWith({ select: { id: true } })
    expect(create).toHaveBeenCalledWith({
      data: { content: '', status: 1 },
    })
  })

  it('preserves an existing homepage during a resumed initialization', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 7 })
    const create = vi.fn()
    const client = {
      systemHomepage: { findFirst, create },
    } as unknown as Pick<AppPrismaClient, 'systemHomepage'>

    await expect(ensureInitialHomepage(client)).resolves.toBe(false)
    expect(create).not.toHaveBeenCalled()
  })

  it('returns no content when the enabled homepage is blank', async () => {
    mocks.prisma.systemHomepage.findFirst.mockResolvedValue({ content: ' \n ' })

    await expect(getHomepageContent()).resolves.toBeNull()
    expect(mocks.prisma.systemHomepage.findFirst).toHaveBeenCalledWith({
      where: { isDeleted: false, status: 1 },
      orderBy: { id: 'desc' },
      select: { content: true },
    })
  })

  it('returns the enabled homepage content without substituting a default document', async () => {
    mocks.prisma.systemHomepage.findFirst.mockResolvedValue({ content: '# Published homepage' })

    await expect(getHomepageContent()).resolves.toBe('# Published homepage')
  })
})
