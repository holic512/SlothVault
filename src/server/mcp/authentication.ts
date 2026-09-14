/**
 * @file authentication.ts
 * @project SlothVault
 * @module MCP Authentication Boundary
 * @description Extracts a bearer MCP API key from external MCP requests and resolves its trusted administrator principal.
 * @logic Accept only a complete Bearer credential, delegate secret validation and account-state checks to the MCP key service, and never fall back to browser session cookies.
 * @dependencies next/server, services/mcp-api-keys
 * @index_tags mcp,authentication,bearer,api-key,administrator,boundary
 * @author holic512
 */
import 'server-only'

import type { NextRequest } from 'next/server'

import {
  authenticateMcpApiKey,
  type McpPrincipal,
} from '@/server/services/mcp-api-keys'

function bearerToken(value: string | null) {
  if (!value) return null
  const match = /^Bearer\s+([^\s]+)$/i.exec(value)
  return match?.[1] || null
}

export async function authenticateMcpRequest(request: NextRequest): Promise<McpPrincipal | null> {
  const key = bearerToken(request.headers.get('authorization'))
  if (!key) return null
  return authenticateMcpApiKey(key)
}
