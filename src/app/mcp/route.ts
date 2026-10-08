/**
 * @file route.ts
 * @project SlothVault
 * @module MCP Streamable HTTP API
 * @description Provides the single external Streamable HTTP entry point for authenticated SlothVault administrator MCP clients.
 * @logic Hold the exclusive maintenance lock through authentication and tool execution, require an installed runtime and valid Bearer key, and preserve MCP JSON-RPC responses.
 * @dependencies Next.js Route Handlers, MCP TypeScript SDK, mcp/authentication, mcp/server, database/runtime-health, maintenance-lock
 * @index_tags mcp,streamable-http,json-rpc,authentication,administrator,route-handler
 * @author holic512
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { NextResponse, type NextRequest } from 'next/server'

import { authenticateMcpRequest } from '@/server/mcp/authentication'
import { createAdminMcpServer } from '@/server/mcp/server'
import { readRuntimeInstallationPublicStatus } from '@/server/database/runtime-health'
import { withMaintenanceLock } from '@/server/services/maintenance-lock'
import { HttpError } from '@/server/http/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function mcpError(status: number, code: number, message: string) {
  return NextResponse.json(
    { jsonrpc: '2.0', error: { code, message }, id: null },
    { status, headers: { 'cache-control': 'no-store' } },
  )
}

export async function POST(request: NextRequest) {
  try {
    return await withMaintenanceLock('exclusive', async () => {
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
      })
      await server.connect(transport)
      return await transport.handleRequest(request)
    })
  } catch (error) {
    if (error instanceof HttpError && error.status === 503) return mcpError(503, -32000, error.message)
    console.error('[mcp] Unhandled MCP request error')
    return mcpError(500, -32603, 'Internal server error')
  }
}

export function GET() {
  return mcpError(405, -32000, 'Method not allowed')
}

export function DELETE() {
  return mcpError(405, -32000, 'Method not allowed')
}
