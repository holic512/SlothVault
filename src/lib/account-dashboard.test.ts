import { describe, expect, it } from 'vitest'

import { summarizeAccountPoints, type AccountPointRecord } from './account-dashboard'

describe('account dashboard point summaries', () => {
  it('keeps credited and spent points separate and uses the recorded balances', () => {
    const records: AccountPointRecord[] = [
      { id: '3', amount: -20, balanceAfter: 130, createdAt: '2026-10-03T08:00:00Z' },
      { id: '1', amount: 100, balanceAfter: 100, createdAt: '2026-10-01T08:00:00Z' },
      { id: '2', amount: 50, balanceAfter: 150, createdAt: '2026-10-02T08:00:00Z' },
    ]
    const original = structuredClone(records)

    expect(summarizeAccountPoints(records)).toEqual({
      income: 150,
      spending: 20,
      balances: [
        [Date.parse('2026-10-01T08:00:00Z'), 100],
        [Date.parse('2026-10-02T08:00:00Z'), 150],
        [Date.parse('2026-10-03T08:00:00Z'), 130],
      ],
    })
    expect(records).toEqual(original)
  })

  it('does not invent chart observations when the account has no transactions', () => {
    expect(summarizeAccountPoints([])).toEqual({ income: 0, spending: 0, balances: [] })
  })

  it('orders simultaneous transactions by their numeric IDs and handles spending-only history', () => {
    const timestamp = '2026-10-01T08:00:00Z'
    const result = summarizeAccountPoints([
      { id: '10', amount: -30, balanceAfter: 50, createdAt: timestamp },
      { id: '2', amount: -20, balanceAfter: 80, createdAt: timestamp },
      { id: '11', amount: 0, balanceAfter: 50, createdAt: timestamp },
    ])

    expect(result.income).toBe(0)
    expect(result.spending).toBe(50)
    expect(result.balances.map(([, balance]) => balance)).toEqual([80, 50, 50])
  })
})
