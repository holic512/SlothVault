/**
 * @file route.ts
 * @project SlothVault
 * @module MCP Client Compatibility API
 * @description Reports authenticated minimum client and supported protocol versions before MCP initialization.
 * @logic Coordinate authentication writes with backups and restores, apply installation and Bearer Key checks, then publish non-secret compatibility metadata.
 * @dependencies Next.js, MCP SDK, mcp/authentication, mcp/server, database/runtime-health, maintenance-lock
 * @index_tags mcp,compatibility,version,protocol,api
 * @author holic512
 */
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js'
import { NextResponse, type NextRequest } from 'next/server'

import { readRuntimeInstallationPublicStatus } from '@/server/database/runtime-health'
import { authenticateMcpRequest } from '@/server/mcp/authentication'
import { withMaintenanceLock } from '@/server/services/maintenance-lock'
import { HttpError } from '@/server/http/errors'
import {
  ADMIN_MCP_SERVER_NAME,
  ADMIN_MCP_SERVER_VERSION,
  MINIMUM_ADMIN_MCP_CLIENT_VERSION,
} from '@/server/mcp/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try { return await withMaintenanceLock('exclusive', () => compatibilityResponse(request)) }
  catch (error) {
    return NextResponse.json({ error: error instanceof HttpError && error.status === 503 ? 'MCP_UNAVAILABLE' : 'MCP_REQUEST_FAILED' }, {
      status: error instanceof HttpError && error.status === 503 ? 503 : 500, headers: { 'cache-control': 'no-store' },
    })
  }
}

async function compatibilityResponse(request: NextRequest) {
  const installation = await readRuntimeInstallationPublicStatus()
  if (installation.status !== 'INSTALLED') {
    return NextResponse.json({ error: 'MCP_UNAVAILABLE' }, {
      status: 503, headers: { 'cache-control': 'no-store' },
    })
  }

  const principal = await authenticateMcpRequest(request)
  if (!principal) {
    return NextResponse.json({ error: 'MCP_AUTH_FAILED' }, {
      status: 401, headers: { 'cache-control': 'no-store' },
    })
  }

  return NextResponse.json({
    schema: 1,
    serverName: ADMIN_MCP_SERVER_NAME,
    serverVersion: ADMIN_MCP_SERVER_VERSION,
    minimumClientVersion: MINIMUM_ADMIN_MCP_CLIENT_VERSION,
    supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
  }, { headers: { 'cache-control': 'no-store' } })
}
