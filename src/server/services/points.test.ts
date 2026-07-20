import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  prisma: {
    giftCardBatch: { findMany: vi.fn(), count: vi.fn() },
    pointTransaction: { findMany: vi.fn(), count: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  },
}))

vi.mock('@/server/database/unit-of-work', () => ({
  unitOfWork: { execute: mocks.execute },
}))

vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))

import { issueGiftCardBatch, redeemGiftCard } from '@/server/services/points'

describe('points and gift cards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns plaintext gift cards once while persisting only hashes and hints', async () => {
    const createBatch = vi.fn().mockResolvedValue({
      id: 7,
      name: 'Launch credits',
      points: 100,
      quantity: 3,
      expiresAt: null,
      createdAt: new Date('2026-07-21T00:00:00.000Z'),
    })
    const createCards = vi.fn().mockResolvedValue({ count: 3 })
    const transaction = {
      giftCardBatch: { create: createBatch },
      giftCard: { createMany: createCards },
    }
    mocks.execute.mockImplementation(async (operation: unknown) =>
      (operation as (tx: typeof transaction) => Promise<unknown>)(transaction),
    )

    const result = await issueGiftCardBatch({
      adminId: 1,
      name: ' Launch credits ',
      points: 100,
      quantity: 3,
    })

    expect(result.codes).toHaveLength(3)
    expect(new Set(result.codes).size).toBe(3)
    for (const code of result.codes) {
      expect(code).toMatch(/^SV-(?:[A-F0-9]{5}-){3}[A-F0-9]{5}$/)
    }

    const persisted = createCards.mock.calls[0]?.[0].data as Array<{
      codeHash: string
      codeHint: string
    }>
    expect(persisted).toHaveLength(3)
    for (const [index, card] of persisted.entries()) {
      expect(card.codeHash).toMatch(/^[a-f0-9]{64}$/)
      expect(card.codeHash).not.toContain(result.codes[index])
      expect(card.codeHint).toBe(`•••• ${result.codes[index].slice(-9)}`)
    }
  })

  it('consumes a card and appends the resulting balance in one transaction', async () => {
    const createTransaction = vi.fn().mockResolvedValue({ id: 15 })
    const transaction = {
      giftCard: {
        findUnique: vi.fn().mockResolvedValue({
          id: 12,
          status: 1,
          batch: {
            name: 'Reader reward',
            points: 40,
            status: 1,
            expiresAt: null,
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        update: vi.fn().mockResolvedValue({ id: 2, pointsBalance: 240 }),
      },
      pointTransaction: { create: createTransaction },
    }
    mocks.execute.mockImplementation(async (operation: unknown) =>
      (operation as (tx: typeof transaction) => Promise<unknown>)(transaction),
    )

    const result = await redeemGiftCard(2, 'sv-aaaaa-bbbbb-ccccc-ddddd')

    expect(transaction.giftCard.updateMany).toHaveBeenCalledWith({
      where: { id: 12, status: 1, redeemedById: null },
      data: expect.objectContaining({ status: 2, redeemedById: 2 }),
    })
    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { pointsBalance: { increment: 40 }, updatedAt: expect.any(Date) },
    })
    expect(createTransaction).toHaveBeenCalledWith({
      data: {
        userId: 2,
        amount: 40,
        balanceAfter: 240,
        type: 'CARD_REDEEM',
        referenceId: '12',
        description: 'Redeemed Reader reward',
      },
    })
    expect(result).toEqual({
      pointsAdded: 40,
      pointsBalance: 240,
      batchName: 'Reader reward',
    })
  })
})
