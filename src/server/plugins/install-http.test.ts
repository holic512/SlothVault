import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ compile: vi.fn(), install: vi.fn(), admin: vi.fn(), generation: vi.fn() }))
vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: async () => ({ status: 'INSTALLED' }), isDatabaseConnectivityError: () => false }))
vi.mock('@/server/auth/session', () => ({ requireAdminSession: mocks.admin }))
vi.mock('@/server/plugins/manager', () => ({ initializePlugins: async () => {}, installPlugin: mocks.install }))
vi.mock('@/server/plugins/compiler', () => ({ ensureCompiledPlugin: mocks.compile }))
vi.mock('@/server/plugins/packages', () => ({ stagedPackageBytes: async () => Buffer.from('source'), verifyPluginPackage: async () => ({ digest: 'a'.repeat(64), manifest: { id: 'test.source' } }) }))
vi.mock('@/server/prisma', () => ({ prisma: { pluginInstallation: { findUnique: mocks.generation } } }))
import { POST } from '@/app/api/admin/mm/plugins/[id]/route'
import { acquireMaintenanceLock } from '@/server/services/maintenance-lock'
import { HttpError } from '@/server/http/errors'
const request = () => new NextRequest('http://localhost/api/admin/mm/plugins/test.source', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'install', digest: 'a'.repeat(64), trusted: true }) })
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue({ userId: 1 }); mocks.generation.mockResolvedValue({ generation: 3 }); mocks.install.mockResolvedValue({ id: 'test.source' }) })
it('does not hold the maintenance lock while source compilation runs', async () => {
  let finish!: () => void
  mocks.compile.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  const pending = POST(request(), { params: Promise.resolve({ id: 'test.source' }) })
  await vi.waitFor(() => expect(mocks.compile).toHaveBeenCalledOnce())
  const readLock = acquireMaintenanceLock('shared')
  const release = await Promise.race([readLock, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Compilation retained maintenance lock')), 1000))])
  release(); finish()
  expect((await pending).status).toBe(200)
  expect(mocks.install).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ expectedGeneration: 3 }))
})
it('never executes installation when compilation fails', async () => {
  mocks.compile.mockRejectedValue(new HttpError('Invalid plugin source', 400))
  expect((await POST(request(), { params: Promise.resolve({ id: 'test.source' }) })).status).toBe(400)
  expect(mocks.install).not.toHaveBeenCalled()
})
