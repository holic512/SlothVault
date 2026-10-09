/**
 * @file account-dashboard.ts
 * @project SlothVault
 * @module Account Dashboard Data
 * @description Converts the account point ledger into recent income, spending, and chronological balance observations.
 * @logic Sum signed transactions separately and order actual balance observations without inventing missing history or changing the source records.
 * @dependencies Account points API contract
 * @index_tags account,dashboard,points,ledger,charts
 * @author holic512
 */

export const ACCOUNT_DASHBOARD_PAGE_SIZE = 30

export type AccountPointRecord = {
  id: string
  amount: number
  balanceAfter: number
  createdAt: string
}

export function summarizeAccountPoints(records: readonly AccountPointRecord[]) {
  const chronological = [...records].sort((left, right) =>
    Date.parse(left.createdAt) - Date.parse(right.createdAt)
    || left.id.localeCompare(right.id, 'en', { numeric: true }),
  )
  const income = records.reduce((total, record) => total + Math.max(record.amount, 0), 0)
  const spending = records.reduce((total, record) => total + Math.max(-record.amount, 0), 0)

  return {
    income,
    spending,
    balances: chronological.map((record): [number, number] => [Date.parse(record.createdAt), record.balanceAfter]),
  }
}

export type AccountPointsSummary = ReturnType<typeof summarizeAccountPoints>
