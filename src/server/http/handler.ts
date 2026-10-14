/**
 * @file handler.ts
 * @project SlothVault
 * @module Server HTTP
 * @description Provides the shared error boundary, typed context, and process-wide read/write coordination for Next.js Route Handlers.
 * @logic Gate normal APIs until installation completes, run read-only methods concurrently, serialize state-changing methods, optionally retain a lock through streamed response consumption, capture privacy-safe request/lock/handler timing, and map domain/validation failures to the API envelope with route-specific cache headers.
 * @dependencies next/server, zod, server/http/errors, server/http/response, maintenance-lock, database/installation-state
 * @index_tags route-handler,error-boundary,validation,maintenance-lock,stream
 * @author holic512
 */
import type { NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { createRequestProbe, type RequestProbe } from '@/server/telemetry/request'

import { DatabaseConfigurationError } from '@/server/database/config-store'
import {
  isInstallationApiPath,
} from '@/server/database/installation-state'
import {
  isDatabaseConnectivityError,
  markInstalledDatabaseUnavailable,
  readRuntimeInstallationPublicStatus,
} from '@/server/database/runtime-health'
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
  cacheControl?: string
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

    if (error instanceof DatabaseConfigurationError) {
      return apiFail(
        'System configuration requires maintenance',
        503,
        5032,
        { reason: 'SYSTEM_MAINTENANCE' },
      )
    }

    if (isDatabaseConnectivityError(error)) {
      markInstalledDatabaseUnavailable()
      return apiFail(
        'Installed database is unavailable',
        503,
        5032,
        { reason: 'SYSTEM_MAINTENANCE' },
      )
    }

    console.error('[api] Unhandled route error', error)
    return apiFail('Internal Server Error', 500, 500)
  }
}

function responseWithLockRelease(response: Response, release: () => void, probe?: RequestProbe) {
  if (!response.body) {
    release()
    probe?.stream('complete')
    return response
  }

  const reader = response.body.getReader()
  let released = false
  let cancellationRequested = false
  const finish = (state: 'complete' | 'canceled' | 'error') => {
    if (released) return
    released = true
    release()
    probe?.stream(state)
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) {
          finish(cancellationRequested ? 'canceled' : 'complete')
          controller.close()
          return
        }
        controller.enqueue(result.value)
      } catch (error) {
        finish('error')
        controller.error(error)
      }
    },
    async cancel(reason) {
      cancellationRequested = true
      try {
        await reader.cancel(reason)
      } finally {
        finish('canceled')
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
    const probe = createRequestProbe(request)
    const measuredHandler: RouteHandler<Params> = async (measuredRequest, measuredContext) => {
      const started = performance.now()
      try { return await handler(measuredRequest, measuredContext) }
      finally { probe?.handler(performance.now() - started) }
    }
    let streamingResponse = false
    const run = async () => {
      const bootstrapSafePath =
        isInstallationApiPath(request.nextUrl.pathname) ||
        request.nextUrl.pathname === '/api/preferences/locale' ||
        request.nextUrl.pathname === '/api/preferences/style' ||
        request.nextUrl.pathname === '/api/preferences/public-nav-style'
      if (!bootstrapSafePath) {
        const installation = await readRuntimeInstallationPublicStatus()
        if (installation.status !== 'INSTALLED') {
          const maintenance = installation.status === 'MAINTENANCE'
          const response = apiFail(
            maintenance ? 'System configuration requires maintenance' : 'System is not installed',
            503,
            maintenance ? 5032 : 5031,
            { reason: maintenance ? 'SYSTEM_MAINTENANCE' : 'SYSTEM_NOT_INSTALLED' },
          )
          if (options.cacheControl) response.headers.set('Cache-Control', options.cacheControl)
          return response
        }
      }

      if (options.lockMode === 'none') {
        const response = await executeRoute(measuredHandler, request, context)
        if (options.cacheControl) response.headers.set('Cache-Control', options.cacheControl)
        return response
      }

      const mode =
        options.lockMode && options.lockMode !== 'auto'
          ? options.lockMode
          : methodLockMode(request.method)
      const response = await executeRoute(async (lockedRequest, lockedContext) => {
        const waitStarted = performance.now()
        let release: () => void
        try { release = await acquireMaintenanceLock(mode) }
        finally { probe?.wait(performance.now() - waitStarted) }
        let retained = false
        try {
          const result = await measuredHandler(lockedRequest, lockedContext)
          if (options.holdLockUntilBodyClosed) {
            streamingResponse = Boolean(result.body)
          const streamed = responseWithLockRelease(result, release, probe)
            retained = true
            return streamed
          }
          return result
        } finally { if (!retained) release() }
      }, request, context)
      if (options.cacheControl) response.headers.set('Cache-Control', options.cacheControl)
      return response
    }
    try {
      const response = await run()
      probe?.finish(response.status, streamingResponse)
      return response
    } catch (error) { probe?.finish(500); throw error }
  }
}
