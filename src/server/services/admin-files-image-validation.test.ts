import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    contract: { findFirst: vi.fn(), findUnique: vi.fn() },
    fileManagement: { update: vi.fn(), updateMany: vi.fn() },
  },
}))

vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))

import {
  withImageValidationCapacity,
} from '@/server/services/admin-files'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('admin image validation capacity', () => {
  it('serializes Sharp work and rejects requests beyond the bounded wait queue', async () => {
    const firstStarted = deferred()
    const releaseFirst = deferred()
    const executionOrder: string[] = []

    const first = withImageValidationCapacity(async () => {
      executionOrder.push('first')
      firstStarted.resolve()
      await releaseFirst.promise
    })
    await firstStarted.promise

    const second = withImageValidationCapacity(async () => {
      executionOrder.push('second')
    })
    const third = withImageValidationCapacity(async () => {
      executionOrder.push('third')
    })
    const rejected = withImageValidationCapacity(async () => {
      executionOrder.push('rejected')
    })

    await expect(rejected).rejects.toMatchObject({
      status: 503,
      code: 5034,
      data: { reason: 'IMAGE_VALIDATION_CAPACITY' },
    })
    expect(executionOrder).toEqual(['first'])

    releaseFirst.resolve()
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ])
    expect(executionOrder).toEqual(['first', 'second', 'third'])
  })
})
