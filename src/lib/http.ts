'use client'

export type ApiResponse<T = unknown> = {
  code: number
  message: string
  data: T
}

export class ApiError extends Error {
  status: number
  data?: unknown

  constructor(message: string, status: number, data?: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.headers || {})
    }
  })

  const contentType = response.headers.get('content-type') || ''
  const isJson = contentType.includes('application/json')
  const payload = isJson ? await response.json() : await response.text()

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload && 'message' in payload
        ? String((payload as { message?: unknown }).message)
        : response.statusText || 'Request failed'
    throw new ApiError(message, response.status, payload)
  }

  if (typeof payload === 'object' && payload && 'code' in payload && 'data' in payload) {
    const apiPayload = payload as ApiResponse<T>
    if (apiPayload.code !== 0) {
      throw new ApiError(apiPayload.message || 'Request failed', response.status, apiPayload)
    }
    return apiPayload.data
  }

  return payload as T
}
