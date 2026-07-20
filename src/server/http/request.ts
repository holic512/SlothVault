/**
 * @file request.ts
 * @project SlothVault
 * @module Server HTTP Requests
 * @description Centralizes JSON validation, identifier parsing, query coercion, and privacy-safe client identity extraction.
 * @logic Parse untrusted request values once and expose a stable client-IP token for Redis-backed abuse controls.
 * @dependencies next/server, zod, server/http/errors
 * @index_tags http,request,validation,client-ip,rate-limit
 * @author holic512
 */
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

export function parseBigIntId(value: string | undefined, label = 'id'): number {
  if (!value) {
    throw new HttpError(`Missing ${label}`, 400, 400)
  }

  try {
    const id = Number(value)
    if (!Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647) throw new Error('range')
    return id
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

export function requestClientIp(request: NextRequest) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  ).slice(0, 255)
}
