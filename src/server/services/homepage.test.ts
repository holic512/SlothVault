import type { AppPrismaClient } from '@/server/database/client'
import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_HOMEPAGE_CONTENT,
  ensureInitialHomepage,
} from '@/server/services/homepage'

describe('initial system homepage', () => {
  it('creates one enabled editable homepage when the database has none', async () => {
    const findFirst = vi.fn().mockResolvedValue(null)
    const create = vi.fn().mockResolvedValue({ id: 1 })
    const client = {
      systemHomepage: { findFirst, create },
    } as unknown as Pick<AppPrismaClient, 'systemHomepage'>

    await expect(ensureInitialHomepage(client)).resolves.toBe(true)
    expect(findFirst).toHaveBeenCalledWith({ select: { id: true } })
    expect(create).toHaveBeenCalledWith({
      data: { content: DEFAULT_HOMEPAGE_CONTENT, status: 1 },
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
})
