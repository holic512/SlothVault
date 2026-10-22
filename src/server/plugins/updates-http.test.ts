import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: vi.fn(), find: vi.fn(), check: vi.fn() }))
vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: async () => ({ status: 'INSTALLED' }), isDatabaseConnectivityError: () => false }))
vi.mock('@/server/auth/session', () => ({ requireAdminSession: mocks.admin }))
vi.mock('@/server/prisma', () => ({ prisma: { pluginInstallation: { findUnique: mocks.find } } }))
vi.mock('@/server/plugins/updates', () => ({ checkPluginUpdate: mocks.check }))
import { HttpError } from '@/server/http/errors'
import { GET } from '@/app/api/admin/mm/plugins/[id]/updates/route'

const invoke = (id = 'test.example', query = '') => GET(new NextRequest(`http://localhost/api/admin/mm/plugins/${id}/updates${query}`), { params: Promise.resolve({ id }) })
const installed = { pluginId: 'test.example', version: '1.0.0', source: 'test/plugins', installed: true }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.admin.mockResolvedValue({ userId: 1 })
  mocks.find.mockResolvedValue(installed)
  mocks.check.mockResolvedValue({ status: 'current', currentVersion: '1.0.0', release: null, checkedAt: '2026-10-22T00:00:00Z' })
})

describe('plugin update HTTP boundary', () => {
  it.each([401, 403])('requires administrator authorization before database or source access (%s)', async status => {
    mocks.admin.mockRejectedValue(new HttpError('Unauthorized', status))
    expect((await invoke()).status).toBe(status)
    expect(mocks.find).not.toHaveBeenCalled()
    expect(mocks.check).not.toHaveBeenCalled()
  })

  it.each([null, { ...installed, installed: false }])('returns 404 for a missing or uninstalled plugin', async item => {
    mocks.find.mockResolvedValue(item)
    expect((await invoke()).status).toBe(404)
    expect(mocks.check).not.toHaveBeenCalled()
  })

  it('validates the route plugin ID before querying storage', async () => {
    expect((await invoke('invalid')).status).toBe(400)
    expect(mocks.find).not.toHaveBeenCalled()
  })

  it('uses the stored source and version, ignores query overrides and disables public caching', async () => {
    const response = await invoke('test.example', '?source=other/repository&version=0.0.0')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.find).toHaveBeenCalledWith({ where: { pluginId: 'test.example' }, select: { pluginId: true, version: true, source: true, installed: true } })
    expect(mocks.check).toHaveBeenCalledWith(installed)
    expect(await response.json()).toMatchObject({ code: 0, data: { status: 'current', currentVersion: '1.0.0' } })
  })

  it('preserves a source failure as an error response instead of reporting current', async () => {
    mocks.check.mockRejectedValue(new HttpError('GitHub plugin source is unavailable', 502))
    const response = await invoke()
    expect(response.status).toBe(502)
    expect((await response.json()).message).toBe('GitHub plugin source is unavailable')
  })
})
