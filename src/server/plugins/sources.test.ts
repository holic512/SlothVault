import { afterEach, expect, it, vi } from 'vitest'
import { listPluginReleases } from './sources'

afterEach(() => vi.unstubAllGlobals())

it('lists a stable release with no release notes', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
    tag_name: 'v1.0.0', draft: false, prerelease: false, body: null,
    assets: [{ name: 'slothvault-plugin-test.example-1.0.0.zip', size: 123 }],
  }]), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  await expect(listPluginReleases('test/plugins')).resolves.toEqual([{
    repository: 'test/plugins', tag: 'v1.0.0', notes: '', version: '1.0.0',
    asset: 'slothvault-plugin-test.example-1.0.0.zip', size: 123,
  }])
})
