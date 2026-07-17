import type { NextRequest } from 'next/server'
import type { ZodType } from 'zod'

import { HttpError } from '@/server/http/errors'

export async function readJson<T>(request: NextRequest, schema: ZodType<T>): Promise<T> {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    throw new HttpError('Invalid JSON body', 400, 400)
  }

  return schema.parse(body)
}

export function parseBigIntId(value: string | undefined, label = 'id'): bigint {
  if (!value) {
    throw new HttpError(`Missing ${label}`, 400, 400)
  }

  try {
    return BigInt(value)
  } catch {
    throw new HttpError(`Invalid ${label}`, 400, 400)
  }
}

export function optionalBoolean(value: string | null): boolean | undefined {
  if (value === null || value === '') return undefined
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  throw new HttpError('Invalid boolean query value', 400, 400)
}
