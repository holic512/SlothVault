/**
 * @file mcp-key-creation.ts
 * @project SlothVault
 * @module One-time MCP Key Creation Boundary
 * @description Consumes a newly created MCP secret without returning it to a mutation cache.
 * @logic Reveal only the current creation result, abort and invalidate superseded requests, strip response secrets, and return allowlisted metadata or a sanitized error.
 * @dependencies api-client, AbortController
 * @index_tags mcp,api-key,one-time,mutation-cache,cancellation,privacy
 * @author holic512
 */
import { ApiClientError } from '@/lib/api-client'

export type McpApiKeyRow = {
  id: string
  name: string
  status: 0 | 1
  keyHint: string
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
}

export type OneTimeMcpKey = { endpoint: string; key: string }
export type CreatedMcpApiKeyResponse = { apiKey: McpApiKeyRow; key: string }

export class McpKeyCreationError extends Error {
  constructor(readonly cancelled: boolean, readonly status?: number) {
    super(cancelled ? 'MCP key creation cancelled' : 'MCP key creation failed')
    this.name = 'McpKeyCreationError'
  }
}

export function adminMcpKeysQueryKey(administratorId: string) {
  return ['admin-mcp-api-keys', administratorId] as const
}

function safeMetadata(value: McpApiKeyRow): McpApiKeyRow {
  return {
    id: value.id, name: value.name, status: value.status, keyHint: value.keyHint,
    expiresAt: value.expiresAt, lastUsedAt: value.lastUsedAt,
    createdAt: value.createdAt, updatedAt: value.updatedAt,
  }
}

export function createOneTimeMcpKeyFlow(reveal: (value: OneTimeMcpKey | null) => void) {
  let generation = 0
  let pending: AbortController | null = null

  return {
    clear() {
      generation += 1
      pending?.abort()
      pending = null
      reveal(null)
    },
    async create(endpoint: string, request: (signal: AbortSignal) => Promise<CreatedMcpApiKeyResponse>) {
      const current = ++generation
      pending?.abort()
      reveal(null)
      const controller = new AbortController()
      pending = controller
      try {
        const response = await request(controller.signal)
        try {
          const metadata = safeMetadata(response.apiKey)
          if (current === generation && !controller.signal.aborted) {
            if (!response.key || /[\u0000-\u0020\u007f-\u009f]/u.test(response.key)) throw new Error('Invalid key response')
            reveal({ endpoint, key: response.key })
          }
          return metadata
        } finally {
          // Never return the complete response to React Query or retain it after disclosure.
          response.key = ''
        }
      } catch (error) {
        throw new McpKeyCreationError(
          current !== generation || controller.signal.aborted,
          error instanceof ApiClientError ? error.status : undefined,
        )
      } finally {
        if (current === generation) pending = null
      }
    },
  }
}
