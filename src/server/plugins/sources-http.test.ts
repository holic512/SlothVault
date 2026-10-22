import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: vi.fn(), install: vi.fn() }))
vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: async () => ({ status: 'INSTALLED' }), isDatabaseConnectivityError: () => false }))
vi.mock('@/server/auth/session', () => ({ requireAdminSession: mocks.admin }))
vi.mock('@/server/plugins/manager', () => ({ listPlugins: async () => [], installPlugin: mocks.install }))
import { GET } from '@/app/api/admin/mm/plugins/sources/route'
import { POST } from '@/app/api/admin/mm/plugins/route'
import { sha256 } from './packages'
import { readTestManifest, readTestPackage } from './test-package'

const repository = 'holic512/SlothVault'
const { id: pluginId, version } = readTestManifest('gift-cards')
const asset = `slothvault-plugin-${pluginId}-${version}.zip`
const request = (tag = 'v2.6.15', name = asset) => new NextRequest('http://localhost/api/admin/mm/plugins', {
  method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
  body: JSON.stringify({ repository, pluginId, tag, asset: name }),
})
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue({ userId: 1 }) })
afterEach(() => vi.unstubAllGlobals())

describe('official plugin discovery and preview contract', () => {
  it('discovers an application Release and previews its real source ZIP through the same official identity policy', async () => {
    const bytes = readTestPackage('gift-cards')
    const release = { tag_name: 'v2.6.15', draft: false, prerelease: false, body: null, assets: [asset, 'checksums.sha256'].map(name => ({ name, size: bytes.length, browser_download_url: `https://github.com/${repository}/releases/download/v2.6.15/${name}` })) }
    const fetch = vi.fn().mockImplementation((url: URL) => {
      if (url.pathname.endsWith('/checksums.sha256')) return Promise.resolve(new Response(`${sha256(bytes)}  ${asset}\n`))
      if (url.pathname.endsWith('.zip')) return Promise.resolve(new Response(bytes))
      return Promise.resolve(new Response(JSON.stringify(url.pathname.endsWith('/releases') ? [release] : release)))
    })
    vi.stubGlobal('fetch', fetch)
    const versions = await GET(new NextRequest(`http://localhost/api/admin/mm/plugins/sources?pluginId=${pluginId}`), { params: Promise.resolve({}) })
    expect(versions.status).toBe(200)
    expect((await versions.json()).data).toEqual([expect.objectContaining({ tag: 'v2.6.15', version, asset })])
    const preview = await POST(request(), { params: Promise.resolve({}) })
    expect(preview.status).toBe(200)
    expect((await preview.json()).data).toMatchObject({ manifest: { id: pluginId, version }, digest: sha256(bytes), verified: true, source: repository })
    expect(mocks.install).not.toHaveBeenCalled()
  })

  it('rejects old independent tags, invalid application tags and prefix-similar plugin IDs before downloading', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    for (const [tag, name] of [['plugin-gift-cards-v1.1.0', asset], ['vgarbage', asset], ['v2.6.15', asset.replace(pluginId, pluginId + '-extra')]]) {
      const response = await POST(request(tag, name), { params: Promise.resolve({}) })
      expect(response.status).toBe(400)
      expect((await response.json()).message).toContain('Official source identity mismatch')
    }
    expect(fetch).not.toHaveBeenCalled()
  })
})
