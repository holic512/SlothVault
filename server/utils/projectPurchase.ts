import { lamportsToSol, solToLamports } from './solana'

export const PurchaseStatus = {
  PREPARED: 0,
  SUBMITTED: 1,
  COMPLETED: 2,
  FAILED: -1,
  EXPIRED_OR_CANCELLED: -2,
} as const

export function normalizeLamports(value: bigint | number | null | undefined): bigint | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'bigint') {
    return value
  }

  if (!Number.isFinite(value) || value < 0) {
    return null
  }

  return BigInt(Math.trunc(value))
}

export function parseSolToLamports(value: unknown): bigint | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const sol =
    typeof value === 'string'
      ? Number(value.trim())
      : typeof value === 'number'
        ? value
        : Number.NaN

  if (!Number.isFinite(sol) || sol < 0) {
    return null
  }

  return BigInt(solToLamports(sol))
}

export function lamportsToSolDisplay(value: bigint | number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const lamports = normalizeLamports(value)
  if (lamports === null) {
    return null
  }

  return lamportsToSol(lamports)
}

export function isPurchaseEnabled(value: bigint | number | null | undefined): boolean {
  const lamports = normalizeLamports(value)
  return lamports !== null && lamports > 0n
}
