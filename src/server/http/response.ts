/**
 * @file response.ts
 * @project SlothVault
 * @module Server HTTP
 * @description Defines the stable API envelope and JSON serialization used by every Next route handler.
 * @logic Convert BigInt values to strings, preserve the legacy code/message/data contract, and set real HTTP status codes.
 * @dependencies next/server
 * @index_tags api,response,bigint,contract
 * @author holic512
 */
import { NextResponse } from 'next/server'

import type { ApiResponse } from '@/types/api'

function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, currentValue) =>
      typeof currentValue === 'bigint' ? currentValue.toString() : currentValue,
    ),
  ) as T
}

export function apiOk<T>(data: T, message = 'ok', status = 200) {
  return NextResponse.json<ApiResponse<T>>(
    jsonSafe({ code: 0, message, data }),
    { status },
  )
}

export function apiFail(
  message: string,
  status = 500,
  code = status,
  data: unknown = null,
) {
  return NextResponse.json<ApiResponse<unknown>>(
    jsonSafe({ code, message, data }),
    { status },
  )
}

export function toJsonSafe<T>(value: T): T {
  return jsonSafe(value)
}
