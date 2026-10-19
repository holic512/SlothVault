import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pluginManifestSchema } from '@slothvault/plugin-sdk/protocol'
const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), invoke: vi.fn(), memberships: vi.fn() }))
vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: async () => ({ status: 'INSTALLED' }), isDatabaseConnectivityError: () => false }))
vi.mock('@/server/auth/session', () => ({ readSession: mocks.session, requireAdminSession: mocks.admin }))
vi.mock('@/server/plugins/manager', () => ({ initializePlugins: vi.fn(), invokeRegisteredPlugin: mocks.invoke, listPlugins: vi.fn(async () => []), installPlugin: vi.fn() }))
vi.mock('@/server/services/membership', () => ({ getActiveMemberships: mocks.memberships }))
vi.mock('@/server/short-lived-state', () => ({ enforceRateLimit: vi.fn() }))
import { HttpError } from '@/server/http/errors'
import { pluginRegistry } from './state'
import { GET, POST } from '@/app/api/plugins/[pluginId]/[...path]/route'
import { GET as adminGet, POST as adminPost } from '@/app/api/admin/mm/plugins/route'
import { GET as assetsGet } from '@/app/api/plugins/assets/[pluginId]/[digest]/[...path]/route'
const ctx = (path: string[]) => ({ params: Promise.resolve({ pluginId: 'slothvault.gift-cards', path }) })
describe('HTTP plugin authorization and disabled gates', () => {
  beforeEach(() => {
    vi.clearAllMocks(); pluginRegistry.clear(); mocks.session.mockResolvedValue(null); mocks.memberships.mockResolvedValue([]); mocks.invoke.mockResolvedValue({ ok: true })
    mocks.admin.mockRejectedValue(new HttpError('Unauthorized', 401))
    pluginRegistry.set('slothvault.gift-cards', { manifest: pluginManifestSchema.parse(JSON.parse(readFileSync('plugins/gift-cards/plugin.json', 'utf8'))), installed: true, enabled: true, generation: 1, digest: 'a'.repeat(64), configCiphertext: '' })
  })
  it('rejects anonymous admin API and asset access before plugin code or disk reads', async () => {
    expect((await adminGet(new NextRequest('http://localhost/api/admin/mm/plugins'), { params: Promise.resolve({}) })).status).toBe(401)
    expect((await GET(new NextRequest('http://localhost/api/plugins/slothvault.gift-cards/batches'), ctx(['batches']))).status).toBe(401)
    expect((await assetsGet(new NextRequest('http://localhost/asset'), { params: Promise.resolve({ pluginId: 'slothvault.gift-cards', digest: 'a'.repeat(64), path: ['client/manage.js'] }) })).status).toBe(401)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
  it('rejects ordinary users on administrator endpoints', async () => {
    mocks.session.mockResolvedValue({ userId: 2, User: { role: 'USER' } })
    expect((await GET(new NextRequest('http://localhost/api/plugins/slothvault.gift-cards/batches'), ctx(['batches']))).status).toBe(403)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
  it('rejects disabled and undeclared APIs even for administrators', async () => {
    mocks.session.mockResolvedValue({ userId: 1, User: { role: 'ADMIN' } })
    expect((await GET(new NextRequest('http://localhost/api/plugins/slothvault.gift-cards/unknown'), ctx(['unknown']))).status).toBe(404)
    pluginRegistry.get('slothvault.gift-cards')!.enabled = false
    expect((await GET(new NextRequest('http://localhost/api/plugins/slothvault.gift-cards/batches'), ctx(['batches']))).status).toBe(409)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
  it('binds business actor from session and enforces same-origin writes', async () => {
    mocks.session.mockResolvedValue({ userId: 2, User: { role: 'USER' } })
    const request = (origin: string) => new NextRequest('http://localhost/api/plugins/slothvault.gift-cards/redeem', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'SV-TEST', actor: { userId: 1, role: 'ADMIN' } }) })
    expect((await POST(request('http://evil.example'), ctx(['redeem']))).status).toBe(403)
    expect((await POST(request('http://localhost'), ctx(['redeem']))).status).toBe(200)
    expect(mocks.invoke).toHaveBeenCalledWith(expect.anything(), 'api', 'redeem', expect.objectContaining({ actor: { userId: 2, role: 'USER' } }), false, false)
    mocks.admin.mockResolvedValue({ userId: 1 })
    expect((await adminPost(new NextRequest('http://localhost/api/admin/mm/plugins', { method: 'POST', headers: { Origin: 'http://evil.example' } }), { params: Promise.resolve({}) })).status).toBe(403)
  })
})
