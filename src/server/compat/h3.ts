import { Buffer } from 'buffer'
import type { NextRequest } from 'next/server'

import { NodeResponseCapture } from '@/server/compat/node-response'

export type MultipartPart = {
  name: string
  filename?: string
  type?: string
  data?: Buffer
}

export type H3Event = {
  request: NextRequest
  context: {
    params?: Record<string, string | string[]>
  }
  node: {
    req: {
      headers: Record<string, string | undefined>
      method: string
      url: string
    }
    res: NodeResponseCapture
  }
  __body?: any
  __formData?: MultipartPart[]
  __cookies: Map<string, { value: string; options?: CookieOptions; delete?: boolean }>
  __status?: number
  __headers: Headers
}

type CookieOptions = {
  httpOnly?: boolean
  sameSite?: 'lax' | 'strict' | 'none'
  secure?: boolean
  path?: string
  maxAge?: number
}

export function defineEventHandler<T>(handler: T): T {
  return handler
}

export function createError(input: {
  statusCode?: number
  statusMessage?: string
  message?: string
  data?: unknown
}) {
  const error = new Error(input.message || input.statusMessage || 'Request failed') as Error & {
    statusCode?: number
    statusMessage?: string
    data?: unknown
  }
  error.statusCode = input.statusCode ?? 500
  error.statusMessage = input.statusMessage ?? input.message
  error.data = input.data
  return error
}

export async function readBody<T = any>(event: H3Event): Promise<T> {
  if (event.__body !== undefined) {
    return event.__body as T
  }

  const contentType = event.request.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    event.__body = await event.request.json()
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await event.request.formData()
    event.__body = Object.fromEntries(formData.entries())
  } else {
    const text = await event.request.text()
    try {
      event.__body = text ? JSON.parse(text) : {}
    } catch {
      event.__body = text
    }
  }

  return event.__body as T
}

export async function readMultipartFormData(event: H3Event) {
  if (event.__formData) {
    return event.__formData
  }

  const formData = await event.request.formData()
  const parts: MultipartPart[] = []
  for (const [name, value] of formData.entries()) {
    if (typeof value === 'string') {
      parts.push({
        name,
        data: Buffer.from(value)
      })
      continue
    }

    const buffer = Buffer.from(await value.arrayBuffer())
    parts.push({
      name,
      filename: value.name,
      type: value.type,
      data: buffer
    })
  }
  event.__formData = parts
  return parts
}

export function getRouterParam(event: H3Event, name: string) {
  const value = event.context.params?.[name]
  return Array.isArray(value) ? value[0] : value
}

export function getQuery(event: H3Event) {
  const query = new URL(event.request.url).searchParams
  const result: Record<string, string | string[]> = {}
  query.forEach((value, key) => {
    if (key in result) {
      const existing = result[key]
      result[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
    } else {
      result[key] = value
    }
  })
  return result
}

export function setResponseStatus(event: H3Event, statusCode: number) {
  event.__status = statusCode
  event.node.res.statusCode = statusCode
}

export function setResponseHeaders(event: H3Event, headers: Record<string, string>) {
  for (const [key, value] of Object.entries(headers)) {
    event.__headers.set(key, value)
    event.node.res.setHeader(key, value)
  }
}

export function setCookie(event: H3Event, name: string, value: string, options: CookieOptions = {}) {
  event.__cookies.set(name, { value, options })
}

export function getCookie(event: H3Event, name: string) {
  return event.request.cookies.get(name)?.value
}

export function deleteCookie(event: H3Event, name: string, options: CookieOptions = {}) {
  event.__cookies.set(name, { value: '', options, delete: true })
}
