import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), create: vi.fn(), status: vi.fn(), remove: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireAdminSession: mocks.session }))
vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: async () => ({ status: 'INSTALLED' }) }))
vi.mock('@/server/services/mcp-api-keys', () => ({
  MCP_API_KEY_STATUS: { ACTIVE: 1, DISABLED: 0 }, listMcpApiKeys: mocks.list, createMcpApiKey: mocks.create,
  setMcpApiKeyStatus: mocks.status, deleteMcpApiKey: mocks.remove,
}))
vi.mock('@/server/services/admin-catalog', () => ({ parseDecimalId: (value: string) => Number(value) }))

import { HttpError } from '@/server/http/errors'
import { GET, POST } from './route'
import * as detail from './[id]/route'

const placeholder = 'SLOTHVAULT_MCP_KEY_EXAMPLE_ONLY'
const metadata = { id: '4', name: 'Example', keyHint: 'svmcp_example…', status: 1 }
const context = { params: Promise.resolve({ id: '4' }) }
function request(method: string, body?: unknown) {
  return new NextRequest('https://vault.example/api/admin/mm/mcp/keys', { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ User: { id: 7 } })
  mocks.list.mockResolvedValue([metadata])
  mocks.create.mockResolvedValue({ apiKey: metadata, key: placeholder })
  mocks.status.mockResolvedValue(metadata)
  mocks.remove.mockResolvedValue(undefined)
})

describe('administrator Key API disclosure boundary', () => {
  it('reveals only the creation response and disables caching for every operation', async () => {
    const created = await POST(request('POST', { name: 'Example' }), { params: Promise.resolve({}) })
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ data: { key: placeholder } })
    expect(created.headers.get('cache-control')).toBe('private, no-store')
    const listed = await GET(request('GET'), { params: Promise.resolve({}) })
    const updated = await detail.PATCH(request('PATCH', { status: 0 }), context)
    const removed = await detail.DELETE(request('DELETE'), context)
    for (const response of [listed, updated, removed]) {
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(await response.text()).not.toContain(placeholder)
    }
    expect(detail).not.toHaveProperty('GET')
  })

  it('scopes all management to the authenticated administrator', async () => {
    for (const userId of [7, 8]) {
      mocks.session.mockResolvedValue({ User: { id: userId } })
      await GET(request('GET'), { params: Promise.resolve({}) })
      await POST(request('POST', { name: 'Example', expiresAt: null }), { params: Promise.resolve({}) })
      await detail.PATCH(request('PATCH', { status: 0 }), context)
      await detail.DELETE(request('DELETE'), context)
      expect(mocks.list).toHaveBeenLastCalledWith(userId)
      expect(mocks.create).toHaveBeenLastCalledWith({ userId, name: 'Example', expiresAt: null })
      expect(mocks.status).toHaveBeenLastCalledWith({ userId, apiKeyId: 4, status: 0 })
      expect(mocks.remove).toHaveBeenLastCalledWith({ userId, apiKeyId: 4 })
    }
  })

  it('keeps error responses private and rejects non-administrators', async () => {
    mocks.session.mockRejectedValue(new HttpError('Forbidden', 403, 403))
    const response = await POST(request('POST', { name: 'Example' }), { params: Promise.resolve({}) })
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
