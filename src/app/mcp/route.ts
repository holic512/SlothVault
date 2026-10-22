/**
 * @file route.ts
 * @project SlothVault
 * @module MCP Streamable HTTP API
 * @description Provides the single external Streamable HTTP entry point for authenticated SlothVault administrator MCP clients.
 * @logic Hold the maintenance lock through authentication and bounded request parsing/tool execution, require an installed runtime and valid Bearer key, and preserve MCP JSON-RPC responses and privacy-safe timing.
 * @dependencies Next.js Route Handlers, MCP TypeScript SDK, mcp/authentication, mcp/server, database/runtime-health, maintenance-lock
 * @index_tags mcp,streamable-http,json-rpc,authentication,administrator,route-handler
 * @author holic512
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { NextResponse, type NextRequest } from 'next/server'

import { authenticateMcpRequest } from '@/server/mcp/authentication'
import { createAdminMcpServer } from '@/server/mcp/server'
import { MCP_MAX_REQUEST_BODY_BYTES } from '@/server/mcp/limits'
import { readRuntimeInstallationPublicStatus } from '@/server/database/runtime-health'
import { withMaintenanceLock } from '@/server/services/maintenance-lock'
import { createRequestProbe } from '@/server/telemetry/request'
import { HttpError } from '@/server/http/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function mcpError(status: number, code: number, message: string) {
  return NextResponse.json(
    { jsonrpc: '2.0', error: { code, message }, id: null },
    { status, headers: { 'cache-control': 'no-store' } },
  )
}

async function handlePost(request: NextRequest, probe: ReturnType<typeof createRequestProbe>) {
  try {
    const waitStarted = performance.now()
    return await withMaintenanceLock('exclusive', async () => {
      probe?.wait(performance.now() - waitStarted)
      const handlerStarted = performance.now()
      try {
        const installation = await readRuntimeInstallationPublicStatus()
        if (installation.status !== 'INSTALLED') {
          return mcpError(503, -32000, 'SlothVault MCP is unavailable until installation completes.')
        }

        const principal = await authenticateMcpRequest(request)
        if (!principal) return mcpError(401, -32001, 'Unauthorized')

        const server = createAdminMcpServer(principal)
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
          maxRequestBodySize: MCP_MAX_REQUEST_BODY_BYTES,
        })
        await server.connect(transport)
        return await transport.handleRequest(request)
      } finally { probe?.handler(performance.now() - handlerStarted) }
    })
  } catch (error) {
    if (error instanceof HttpError && error.status === 503) return mcpError(503, -32000, error.message)
    console.error('[mcp] Unhandled MCP request error')
    return mcpError(500, -32603, 'Internal server error')
  }
}

export function GET(request?: NextRequest) {
  const probe = request ? createRequestProbe(request) : undefined; probe?.finish(405)
  return mcpError(405, -32000, 'Method not allowed')
}

export function DELETE(request?: NextRequest) {
  const probe = request ? createRequestProbe(request) : undefined; probe?.finish(405)
  return mcpError(405, -32000, 'Method not allowed')
}

export async function POST(request: NextRequest) {
  const probe = createRequestProbe(request)
  try { const response = await handlePost(request, probe); probe?.finish(response.status); return response }
  catch (error) { probe?.finish(500); throw error }
}
