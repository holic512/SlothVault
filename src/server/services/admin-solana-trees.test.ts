import { describe, expect, it } from 'vitest'

import { reconciledRemainingCapacity } from '@/server/services/admin-solana-trees'

describe('portable Merkle Tree capacity reconciliation', () => {
  it('recomputes exact remaining capacity when no attempts are pending', () => {
    expect(
      reconciledRemainingCapacity({
        maxCapacity: 10n,
        currentSequence: 7,
        pendingAttempts: 0,
        storedRemainingCapacity: 2n,
      }),
    ).toMatchObject({ valid: false, remainingCapacity: 3n })

    expect(
      reconciledRemainingCapacity({
        maxCapacity: 10n,
        currentSequence: 7,
        pendingAttempts: 0,
        storedRemainingCapacity: 3n,
      }),
    ).toMatchObject({ valid: true, remainingCapacity: 3n })
  })

  it('preserves authoritative capacity for an out-of-order pending lower leaf', () => {
    expect(
      reconciledRemainingCapacity({
        maxCapacity: 10n,
        currentSequence: 7,
        pendingAttempts: 1,
        storedRemainingCapacity: 3n,
      }),
    ).toMatchObject({
      valid: true,
      lowerBound: 2n,
      upperBound: 3n,
      remainingCapacity: 3n,
    })
  })

  it('accepts a future pending reservation at the lower bound', () => {
    expect(
      reconciledRemainingCapacity({
        maxCapacity: 10n,
        currentSequence: 7,
        pendingAttempts: 1,
        storedRemainingCapacity: 2n,
      }),
    ).toMatchObject({ valid: true, remainingCapacity: 2n })
  })

  it('rejects capacity outside the pending-aware bounds', () => {
    expect(
      reconciledRemainingCapacity({
        maxCapacity: 10n,
        currentSequence: 7,
        pendingAttempts: 1,
        storedRemainingCapacity: 4n,
      }).valid,
    ).toBe(false)
    expect(
      reconciledRemainingCapacity({
        maxCapacity: 10n,
        currentSequence: 7,
        pendingAttempts: 1,
        storedRemainingCapacity: 1n,
      }).valid,
    ).toBe(false)
  })
})
