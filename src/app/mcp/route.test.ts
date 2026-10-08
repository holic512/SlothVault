import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), health: vi.fn(), connect: vi.fn(), handle: vi.fn() }))
vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: mocks.health }))
vi.mock('@/server/mcp/authentication', () => ({ authenticateMcpRequest: mocks.auth }))
vi.mock('@/server/mcp/server', () => ({
  createAdminMcpServer: () => ({ connect: mocks.connect }),
  ADMIN_MCP_SERVER_NAME: 'slothvault-admin-mcp', ADMIN_MCP_SERVER_VERSION: '4.0.0', MINIMUM_ADMIN_MCP_CLIENT_VERSION: '1.0.0',
}))
vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
  WebStandardStreamableHTTPServerTransport: class { handleRequest = mocks.handle },
}))
import { POST } from './route'
import { GET as compatibility } from './compatibility/route'
import { acquireMaintenanceLock } from '@/server/services/maintenance-lock'
import { setBackupRecoveryError } from '@/server/services/admin-backup/recovery-state'

beforeEach(() => {
  vi.clearAllMocks(); setBackupRecoveryError(null)
  mocks.health.mockResolvedValue({ status: 'INSTALLED' })
  mocks.auth.mockResolvedValue({ userId: 1 })
  mocks.connect.mockResolvedValue(undefined)
  mocks.handle.mockResolvedValue(Response.json({ jsonrpc: '2.0', result: {} }))
})
afterEach(() => { setBackupRecoveryError(null) })
describe('MCP maintenance coordination', () => {
  it('waits for the backup lock before authentication or tool handling', async () => {
    const release = await acquireMaintenanceLock('shared')
    const response = POST(new NextRequest('http://localhost/mcp', { method: 'POST' }))
    await Promise.resolve(); await Promise.resolve()
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.handle).not.toHaveBeenCalled()
    release()
    expect((await response).status).toBe(200)
    expect(mocks.auth).toHaveBeenCalledOnce(); expect(mocks.handle).toHaveBeenCalledOnce()
  })
  it('also coordinates compatibility authentication writes', async () => {
    const release = await acquireMaintenanceLock('exclusive')
    const response = compatibility(new NextRequest('http://localhost/mcp/compatibility'))
    await Promise.resolve(); await Promise.resolve()
    expect(mocks.auth).not.toHaveBeenCalled()
    release()
    expect((await response).status).toBe(200)
  })
  it('rejects queued requests when recovery enters maintenance before releasing the writer', async () => {
    const release = await acquireMaintenanceLock('exclusive')
    const response = POST(new NextRequest('http://localhost/mcp', { method: 'POST' }))
    setBackupRecoveryError('Backup recovery requires maintenance'); release()
    expect((await response).status).toBe(503)
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.handle).not.toHaveBeenCalled()
  })
})
