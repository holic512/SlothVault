import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  installation: vi.fn(),
  authenticate: vi.fn(),
}))

vi.mock('@/server/database/runtime-health', () => ({
  readRuntimeInstallationPublicStatus: mocks.installation,
}))
vi.mock('@/server/mcp/authentication', () => ({
  authenticateMcpRequest: mocks.authenticate,
}))

import { GET } from './route'

const request = () => new Request('https://vault.example/mcp/compatibility') as NextRequest

describe('MCP compatibility policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.installation.mockResolvedValue({ status: 'INSTALLED' })
    mocks.authenticate.mockResolvedValue({ id: 'administrator' })
  })

  it('returns authenticated version and protocol metadata without credentials', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json()
    expect(body).toMatchObject({
      schema: 1,
      serverName: 'slothvault-admin-mcp',
      minimumClientVersion: '1.0.0',
    })
    expect(body.supportedProtocolVersions).toContain('2025-11-25')
    expect(JSON.stringify(body)).not.toContain('administrator')
  })

  it('rejects unauthenticated reads', async () => {
    mocks.authenticate.mockResolvedValue(null)
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(mocks.authenticate).toHaveBeenCalledOnce()
  })

  it('preserves the MCP installation boundary', async () => {
    mocks.installation.mockResolvedValue({ status: 'NOT_INSTALLED' })
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(mocks.authenticate).not.toHaveBeenCalled()
  })
})
