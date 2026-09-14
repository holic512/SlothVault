/**
 * @file route.ts
 * @project SlothVault
 * @module MCP Streamable HTTP API
 * @description Provides the single external Streamable HTTP entry point for authenticated SlothVault administrator MCP clients.
 * @logic Require an installed runtime and a valid MCP Bearer key before creating a stateless MCP server for the request, then preserve MCP JSON-RPC response semantics outside the website API envelope.
 * @dependencies Next.js Route Handlers, MCP TypeScript SDK, mcp/authentication, mcp/server, database/runtime-health
 * @index_tags mcp,streamable-http,json-rpc,authentication,administrator,route-handler
 * @author holic512
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { NextResponse, type NextRequest } from 'next/server'

import { authenticateMcpRequest } from '@/server/mcp/authentication'
import { createAdminMcpServer } from '@/server/mcp/server'
import { readRuntimeInstallationPublicStatus } from '@/server/database/runtime-health'

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
  } catch (error) {
    console.error('[mcp] Unhandled MCP request error', error)
    return mcpError(500, -32603, 'Internal server error')
  }
}

export function GET() {
  return mcpError(405, -32000, 'Method not allowed')
}

export function DELETE() {
  return mcpError(405, -32000, 'Method not allowed')
}
