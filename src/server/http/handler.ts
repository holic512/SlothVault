/**
 * @file handler.ts
 * @project SlothVault
 * @module Server HTTP
 * @description Provides the shared error boundary, typed context, and process-wide read/write coordination for Next.js Route Handlers.
 * @logic Run read-only methods concurrently, serialize state-changing methods, optionally retain a lock through streamed response consumption, and map domain/validation failures to the API envelope.
 * @dependencies next/server, zod, server/http/errors, server/http/response, maintenance-lock
 * @index_tags route-handler,error-boundary,validation,maintenance-lock,stream
 * @author holic512
 */
import type { NextRequest } from 'next/server'
import { ZodError } from 'zod'

import { HttpError } from '@/server/http/errors'
import { apiFail } from '@/server/http/response'
import {
  acquireMaintenanceLock,
  type MaintenanceLockMode,
} from '@/server/services/maintenance-lock'

export type RouteContext<Params extends Record<string, unknown> = Record<string, never>> = {
  params: Promise<Params>
}

export type RouteHandler<Params extends Record<string, unknown> = Record<string, never>> = (
  request: NextRequest,
  context: RouteContext<Params>,
) => Promise<Response>

export type RouteOptions = {
  holdLockUntilBodyClosed?: boolean
  lockMode?: MaintenanceLockMode | 'auto' | 'none'
}

function methodLockMode(method: string): MaintenanceLockMode {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
    ? 'shared'
    : 'exclusive'
}

async function executeRoute<Params extends Record<string, unknown>>(
  handler: RouteHandler<Params>,
  request: NextRequest,
  context: RouteContext<Params>,
) {
  try {
    return await handler(request, context)
  } catch (error) {
    if (error instanceof HttpError) {
      return apiFail(error.message, error.status, error.code, error.data)
    }

    if (error instanceof ZodError) {
      return apiFail('Invalid request data', 400, 400, error.flatten())
    }

    console.error('[api] Unhandled route error', error)
    return apiFail('Internal Server Error', 500, 500)
  }
}

function responseWithLockRelease(response: Response, release: () => void) {
  if (!response.body) {
    release()
    return response
  }

  const reader = response.body.getReader()
  let released = false
  const finish = () => {
    if (released) return
    released = true
    release()
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) {
          finish()
          controller.close()
          return
        }
        controller.enqueue(result.value)
      } catch (error) {
        finish()
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        finish()
      }
    },
  })

  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  })
}

export function defineRoute<Params extends Record<string, unknown> = Record<string, never>>(
  handler: RouteHandler<Params>,
  options: RouteOptions = {},
): RouteHandler<Params> {
  return async (request, context) => {
    if (options.lockMode === 'none') {
      return executeRoute(handler, request, context)
    }

    const mode =
      options.lockMode && options.lockMode !== 'auto'
        ? options.lockMode
        : methodLockMode(request.method)
    const release = await acquireMaintenanceLock(mode)
    const response = await executeRoute(handler, request, context)

    if (options.holdLockUntilBodyClosed) {
      return responseWithLockRelease(response, release)
    }
    release()
    return response
  }
}
