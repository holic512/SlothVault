/**
 * @file api-client.ts
 * @project SlothVault
 * @module Client Data Access
 * @description Centralizes browser requests against the stable SlothVault API envelope.
 * @logic Send same-origin credentials, parse JSON once, and raise a typed error for HTTP or business failures.
 * @dependencies browser fetch, types/api
 * @index_tags fetch,api-client,error,react-query
 * @author holic512
 */
import type { ApiResponse } from '@/types/api'

export class ApiClientError extends Error {
  readonly status: number
  readonly code: number
  readonly data: unknown

  constructor(message: string, status: number, code: number, data: unknown) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
    this.data = data
  }
}

export async function apiFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  })

  let payload: ApiResponse<T>
  try {
    payload = (await response.json()) as ApiResponse<T>
  } catch {
    throw new ApiClientError('Invalid server response', response.status, response.status, null)
  }

  if (!response.ok || payload.code !== 0) {
    throw new ApiClientError(
      payload.message || response.statusText || 'Request failed',
      response.status,
      payload.code,
      payload.data,
    )
  }

  return payload.data
}
