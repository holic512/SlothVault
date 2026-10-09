import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { ApiClientError } from './api-client'
import { adminMcpKeysQueryKey, createOneTimeMcpKeyFlow, McpKeyCreationError, type CreatedMcpApiKeyResponse, type OneTimeMcpKey } from './mcp-key-creation'

const placeholder = 'SLOTHVAULT_MCP_KEY_EXAMPLE_ONLY'
const metadata = { id: '1', name: 'Example', status: 1 as const, keyHint: 'svmcp_example…', expiresAt: null, lastUsedAt: null, createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('one-time MCP Key lifecycle', () => {
  it('returns only metadata to the real MutationCache and clears the consumed response', async () => {
    const client = new QueryClient()
    let disclosure: OneTimeMcpKey | null = null
    const flow = createOneTimeMcpKeyFlow((value) => { disclosure = value })
    const response = { apiKey: { ...metadata, unexpectedSecret: placeholder }, key: placeholder }
    const mutation = client.getMutationCache().build(client, { retry: false, mutationFn: () => flow.create('https://vault.example/mcp', async () => response) })
    await expect(mutation.execute(undefined)).resolves.toEqual(metadata)
    expect(disclosure).toEqual({ endpoint: 'https://vault.example/mcp', key: placeholder })
    expect(response.key).toBe('')
    client.setQueryData(adminMcpKeysQueryKey('1'), [mutation.state.data])
    expect(JSON.stringify(client.getMutationCache().getAll().map((item) => item.state))).not.toContain(placeholder)
    expect(JSON.stringify(client.getQueryCache().getAll().map((item) => item.state))).not.toContain(placeholder)
    flow.clear()
    expect(disclosure).toBeNull()
    client.clear()
  })

  it('sanitizes errors before they enter MutationCache', async () => {
    const client = new QueryClient()
    const flow = createOneTimeMcpKeyFlow(() => {})
    const mutation = client.getMutationCache().build(client, { retry: false, mutationFn: () => flow.create('https://vault.example/mcp', async () => { throw new ApiClientError(placeholder, 500, 500, { key: placeholder }) }) })
    await expect(mutation.execute(undefined)).rejects.toBeInstanceOf(McpKeyCreationError)
    expect(mutation.state.error).toMatchObject({ message: 'MCP key creation failed', status: 500 })
    expect(mutation.state.error).not.toHaveProperty('data')
    expect(mutation.state.error).not.toHaveProperty('cause')
    expect(JSON.stringify(mutation.state)).not.toContain(placeholder)
    client.clear()
  })

  it('does not reopen a disclosure when a cancelled response arrives late', async () => {
    let disclosure: OneTimeMcpKey | null = null
    let signal!: AbortSignal
    const flow = createOneTimeMcpKeyFlow((value) => { disclosure = value })
    const pending = deferred<CreatedMcpApiKeyResponse>()
    const result = flow.create('https://vault.example/mcp', (value) => { signal = value; return pending.promise })
    flow.clear()
    expect(signal.aborted).toBe(true)
    const response = { apiKey: metadata, key: placeholder }
    pending.resolve(response)
    await result
    expect(disclosure).toBeNull()
    expect(response.key).toBe('')
  })

  it('invalidates superseded requests and keeps only the new flow', async () => {
    let disclosure: OneTimeMcpKey | null = null
    const flow = createOneTimeMcpKeyFlow((value) => { disclosure = value })
    const first = deferred<CreatedMcpApiKeyResponse>()
    const old = flow.create('https://old.example/mcp', () => first.promise)
    await flow.create('https://new.example/mcp', async () => ({ apiKey: metadata, key: `${placeholder}_NEW` }))
    first.resolve({ apiKey: metadata, key: placeholder })
    await old
    expect(disclosure).toEqual({ endpoint: 'https://new.example/mcp', key: `${placeholder}_NEW` })
    flow.clear()
    expect(disclosure).toBeNull()
  })

  it('separates administrator caches', () => {
    const client = new QueryClient()
    client.setQueryData(adminMcpKeysQueryKey('1'), [metadata])
    expect(client.getQueryData(adminMcpKeysQueryKey('2'))).toBeUndefined()
    client.clear()
  })
})
