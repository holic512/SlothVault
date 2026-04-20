import { NextRequest, NextResponse } from 'next/server'

import type { H3Event } from '@/server/compat/h3'
import { NodeResponseCapture } from '@/server/compat/node-response'

type LegacyHandler = (event: H3Event) => Promise<unknown> | unknown

function buildEvent(request: NextRequest, params?: Record<string, string | string[]>): H3Event {
  const nodeRes = new NodeResponseCapture()
  const headers: Record<string, string | undefined> = {}
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  const normalizedParams = Object.fromEntries(
    Object.entries(params || {}).map(([key, value]) => [key, Array.isArray(value) ? value.join('/') : value])
  )

  return {
    request,
    context: { params: normalizedParams },
    node: {
      req: {
        headers,
        method: request.method,
        url: request.url
      },
      res: nodeRes
    },
    __cookies: new Map(),
    __headers: new Headers()
  }
}

function applyCookies(response: NextResponse, event: H3Event) {
  for (const [name, entry] of event.__cookies.entries()) {
    if (entry.delete) {
      response.cookies.set(name, '', {
        path: entry.options?.path || '/',
        expires: new Date(0)
      })
      continue
    }

    response.cookies.set(name, entry.value, {
      httpOnly: entry.options?.httpOnly,
      sameSite: entry.options?.sameSite,
      secure: entry.options?.secure,
      path: entry.options?.path,
      maxAge: entry.options?.maxAge
    })
  }
}

function buildHeaders(event: H3Event) {
  const headers = new Headers(event.__headers)
  event.node.res.getHeaders().forEach((value, key) => {
    headers.set(key, value)
  })
  return headers
}

export async function handleLegacyApiRequest(
  handler: LegacyHandler,
  request: NextRequest,
  params?: Record<string, string | string[]>
) {
  const event = buildEvent(request, params)

  try {
    const result = await handler(event)
    const status = event.__status ?? event.node.res.statusCode ?? 200
    const headers = buildHeaders(event)

    let response: NextResponse
    if (event.node.res.hasBody()) {
      response = new NextResponse(event.node.res.getBody(), {
        status,
        headers
      })
    } else if (result instanceof Uint8Array || result instanceof ArrayBuffer || Buffer.isBuffer(result)) {
      response = new NextResponse(result as any, {
        status,
        headers
      })
    } else if (result === undefined || result === null) {
      response = new NextResponse(null, {
        status,
        headers
      })
    } else if (typeof result === 'string') {
      response = new NextResponse(result, {
        status,
        headers
      })
    } else {
      response = NextResponse.json(result, {
        status,
        headers
      })
    }

    applyCookies(response, event)
    return response
  } catch (error) {
    const statusCode =
      typeof error === 'object' && error && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500
    const message =
      typeof error === 'object' && error && 'message' in error && typeof error.message === 'string'
        ? error.message
        : 'Internal Server Error'

    const response = NextResponse.json(
      {
        code: statusCode,
        message,
        data:
          typeof error === 'object' && error && 'data' in error
            ? (error as { data?: unknown }).data ?? null
            : null
      },
      {
        status: statusCode,
        headers: buildHeaders(event)
      }
    )
    applyCookies(response, event)
    return response
  }
}
