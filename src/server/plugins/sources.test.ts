import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadPluginRelease, githubBytes, listPluginReleases, OFFICIAL_PLUGINS, officialPluginSourceMatches } from './sources'
import { sha256 } from './packages'

const asset = 'slothvault-plugin-test.example-1.0.0.zip'
const assetUrl = (name: string) => `https://github.com/test/plugins/releases/download/v2.6.15/${name}`
const release = (tag = 'v2.6.15', names = [asset, 'checksums.sha256']) => ({
  tag_name: tag, draft: false, prerelease: false, body: null, published_at: '2026-10-21T00:00:00Z',
  assets: names.map(name => ({ name, size: 123, browser_download_url: assetUrl(name) })),
})
const json = (value: unknown, headers?: HeadersInit) => new Response(JSON.stringify(value), { status: 200, headers })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('application release discovery', () => {
  it('lists a complete stable release with no notes and preserves the existing response shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json([release()])))
    await expect(listPluginReleases('test/plugins')).resolves.toEqual([{
      repository: 'test/plugins', tag: 'v2.6.15', notes: '', version: '1.0.0', asset, size: 123,
    }])
  })

  it('requires complete stable packages, an exact plugin ID and a valid application tag', async () => {
    const releases = [
      release('v2.6.14', ['slothvault-image-manifest.json']),
      release('v2.6.15', [asset]), release('v2.6.16', [asset, 'checksums.sha256', 'checksums.sha256']),
      { ...release('v2.6.17'), draft: true }, { ...release('v2.6.18'), prerelease: true },
      release('plugin-example-v1.0.0'), release('vgarbage'), release('v02.0.0'),
      release('v2.6.19', ['slothvault-plugin-test.example-extra-1.0.0.zip', 'checksums.sha256']),
      release('v2.6.20', ['slothvault-plugin-test.example-01.0.0.zip', 'checksums.sha256']),
      release(),
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(releases)))
    const result = await listPluginReleases('test/plugins', 'v', 'test.example')
    expect(result.map(item => item.tag)).toEqual(['v2.6.15'])
  })

  it('follows safe pagination and deduplicates plugin versions in favor of the highest application version', async () => {
    const next = 'https://api.github.com/repos/test/plugins/releases?per_page=100&page=2'
    const fetch = vi.fn()
      .mockResolvedValueOnce(json([release('v2.6.20'), release('v2.7.0')], { Link: `<${next}>; rel="next"` }))
      .mockResolvedValueOnce(json([release('v2.6.15'), release('v2.6.19', ['slothvault-plugin-test.example-1.1.0.zip', 'checksums.sha256'])]))
    vi.stubGlobal('fetch', fetch)
    const result = await listPluginReleases('test/plugins', 'v', 'test.example')
    expect(result.map(item => [item.version, item.tag])).toEqual([['1.1.0', 'v2.6.19'], ['1.0.0', 'v2.7.0']])
    expect(fetch.mock.calls[1][0].href).toBe(next)
  })

  it('finds a plugin beyond the first 100 application releases', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(Array.from({ length: 100 }, (_, index) => release(`v3.0.${index}`, ['slothvault-image-manifest.json'])), {
      Link: '<https://api.github.com/repos/test/plugins/releases?per_page=100&page=2>; rel="next"',
    })).mockResolvedValueOnce(json([release()]))
    vi.stubGlobal('fetch', fetch)
    expect(await listPluginReleases('test/plugins')).toHaveLength(1)
  })

  it('reports scan limits and pagination failures rather than returning an empty version list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: URL) => {
      const page = Number(url.searchParams.get('page') ?? 1)
      return Promise.resolve(json([], { Link: `<https://api.github.com/repos/test/plugins/releases?per_page=100&page=${page + 1}>; rel="next"` }))
    }))
    await expect(listPluginReleases('test/plugins')).rejects.toThrow('scan limit')
    const fetch = vi.fn().mockResolvedValueOnce(json([], { Link: '<https://api.github.com/repos/test/plugins/releases?page=2>; rel="next"' })).mockResolvedValueOnce(new Response('', { status: 500 }))
    vi.stubGlobal('fetch', fetch)
    await expect(listPluginReleases('test/plugins')).rejects.toThrow('unavailable')
  })

  it('rejects untrusted pagination, malformed responses and rate limits', async () => {
    for (const value of [{ invalid: true }, [{ tag_name: 'v2.6.15' }]]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(value)))
      await expect(listPluginReleases('test/plugins')).rejects.toThrow('Invalid GitHub response')
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json([], { Link: '<https://evil.example/releases?page=2>; rel="next"' })))
    await expect(listPluginReleases('test/plugins')).rejects.toThrow('pagination')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })))
    await expect(listPluginReleases('test/plugins')).rejects.toThrow('rate limit')
  })

  it('uses the same official identity policy for discovery and preview', () => {
    const official = OFFICIAL_PLUGINS[0]
    const name = `slothvault-plugin-${official.id}-1.1.0.zip`
    expect(officialPluginSourceMatches(official, official.repository, 'v2.6.15', name)).toBe(true)
    for (const [repository, tag, asset] of [
      ['other/repository', 'v2.6.15', name], [official.repository, 'plugin-gift-cards-v1.1.0', name],
      [official.repository, 'vgarbage', name], [official.repository, 'v2.6.15', name.replace(official.id, official.id + '-extra')],
    ]) expect(officialPluginSourceMatches(official, repository, tag, asset)).toBe(false)
  })
})

describe('release download integrity', () => {
  const bytes = Buffer.from('source-package')
  it('downloads only the selected ZIP and checks it against its exact checksum entry', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(release())).mockResolvedValueOnce(new Response(`${sha256(bytes)}  ${asset}\n`)).mockResolvedValueOnce(new Response(bytes))
    vi.stubGlobal('fetch', fetch)
    expect(await downloadPluginRelease('test/plugins', 'v2.6.15', asset)).toEqual(bytes)
  })

  it('rejects missing checksums, duplicate entries, hash mismatches and unstable releases', async () => {
    for (const metadata of [release('v2.6.15', [asset]), { ...release(), prerelease: true }, { ...release(), draft: true }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(metadata)))
      await expect(downloadPluginRelease('test/plugins', 'v2.6.15', asset)).rejects.toThrow()
    }
    for (const hashes of ['', `${sha256(bytes)}  ${asset}\n${sha256(bytes)}  ${asset}\n`, `${'0'.repeat(64)}  ${asset}\n`]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(release())).mockResolvedValueOnce(new Response(hashes)).mockResolvedValueOnce(new Response(bytes)))
      await expect(downloadPluginRelease('test/plugins', 'v2.6.15', asset)).rejects.toThrow('SHA-256')
    }
  })

  it('continues to reject unsafe redirects and oversized downloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 302, headers: { Location: 'http://127.0.0.1/private' } })))
    await expect(githubBytes(assetUrl(asset), 1024)).rejects.toThrow('Untrusted')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('too-large', { headers: { 'Content-Length': '9' } })))
    await expect(githubBytes(assetUrl(asset), 2)).rejects.toThrow('size limit')
  })
})
