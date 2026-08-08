/**
 * @file values.ts
 * @project SlothVault
 * @module Admin Catalog Values
 * @description Normalizes catalog request values and database-specific filters and error codes.
 * @logic Validate decimal identifiers and primitive request values, derive pagination and ordering inputs, and expose provider-aware text matching.
 * @dependencies server/database/client, server/http/errors, Prisma filter types
 * @index_tags admin,catalog,validation,pagination,prisma
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { configuredDatabaseProvider } from '@/server/database/client'
import { HttpError } from '@/server/http/errors'

const DECIMAL_ID_PATTERN = /^\d+$/

const MAX_DATABASE_ID = 2_147_483_647

export function parseDecimalId(value: string | undefined, label = 'id'): number {
  if (value === undefined) {
    throw new HttpError(`Missing ${label}`, 400, 400)
  }
  if (!DECIMAL_ID_PATTERN.test(value)) {
    throw new HttpError(`Invalid ${label}`, 400, 400)
  }
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1 || id > MAX_DATABASE_ID) {
    throw new HttpError(`Invalid ${label}`, 400, 400)
  }
  return id
}

export function parseJsonDecimalId(value: unknown, label: string): number {
  if (value === undefined) {
    throw new HttpError(`Missing ${label}`, 400, 400)
  }
  if (typeof value !== 'string' || !DECIMAL_ID_PATTERN.test(value)) {
    throw new HttpError(`Invalid ${label}`, 400, 400)
  }
  return parseDecimalId(value, label)
}

export function parseJsonDecimalIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null

  const ids: number[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !DECIMAL_ID_PATTERN.test(item)) return null
    const id = Number(item)
    if (!Number.isSafeInteger(id) || id < 1 || id > MAX_DATABASE_ID) return null
    ids.push(id)
  }
  return ids
}

export function integerValue(value: unknown, fallback: number): number {
  const numberValue =
    typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : fallback
}

export function optionalIntegerValue(value: unknown): number | null {
  const numberValue =
    typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : null
}

export function legacyBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false
  return value === '1' || value.toLowerCase() === 'true'
}

export function optionalLegacyBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null
  if (value === '1' || value.toLowerCase() === 'true') return true
  if (value === '0' || value.toLowerCase() === 'false') return false
  return null
}

export function pagination(searchParams: URLSearchParams) {
  const page = Math.max(1, integerValue(searchParams.get('page'), 1))
  const pageSize = Math.min(100, Math.max(1, integerValue(searchParams.get('pageSize'), 10)))
  return { page, pageSize, skip: (page - 1) * pageSize }
}

export function sortDirection(value: string | null): 'asc' | 'desc' {
  return value?.toLowerCase() === 'asc' ? 'asc' : 'desc'
}

export function safeOrderField<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return value && allowed.includes(value as T) ? (value as T) : fallback
}

export function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}

export function databaseTextContains(value: string): Prisma.StringFilter {
  return configuredDatabaseProvider() === 'postgresql'
    ? { contains: value, mode: 'insensitive' }
    : { contains: value }
}
