/**
 * @file sources.ts
 * @project SlothVault
 * @module GitHub Plugin Source
 * @description Discovers source plugins attached to stable application Releases without cloning repository source.
 * @logic Bound pagination and downloads, select exact plugin identities, deduplicate repeated versions, and verify release checksums before staging.
 * @dependencies fetch, plugin package limits, node crypto, official catalog
 * @index_tags plugins,github,releases,download,ssrf,pagination
 * @author holic512
 */
import 'server-only'
import { z } from 'zod'
import semver from 'semver'
import catalog from '../../../plugins/catalog.json'
import { pluginIdSchema } from '@slothvault/plugin-sdk/protocol'
import { HttpError } from '@/server/http/errors'
import { MAX_PLUGIN_PACKAGE_BYTES, sha256 } from './packages'

export const OFFICIAL_PLUGINS = z.object({ schema: z.literal(1), plugins: z.array(z.object({ id: pluginIdSchema, name: z.string(), nameZh: z.string(), description: z.string(), descriptionZh: z.string(), repository: z.string().refine(value => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)), tagPrefix: z.string().min(1) }).strict()) }).strict().parse(catalog).plugins
const hosts = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'])
const releaseSchema = z.object({
  tag_name: z.string().max(150), draft: z.boolean(), prerelease: z.boolean(), body: z.string().nullable(),
  published_at: z.string().nullable().optional(),
  assets: z.array(z.object({ name: z.string().max(200), browser_download_url: z.string().url(), size: z.number().int().nonnegative() })).max(1000),
})
const applicationVersion = (tag: string) => /^v\d+\.\d+\.\d+$/.test(tag) ? semver.valid(tag.slice(1)) : null
const matchesReleaseTag = (tag: string, prefix: string) => prefix === 'v' ? applicationVersion(tag) !== null : tag.startsWith(prefix)

function pluginAsset(name: string) {
  const match = /^slothvault-plugin-([a-z0-9.-]+)-(\d+\.\d+\.\d+)\.zip$/.exec(name)
  return match && pluginIdSchema.safeParse(match[1]).success && semver.valid(match[2]) ? { id: match[1], version: match[2] } : null
}
export function officialPluginSourceMatches(official: typeof OFFICIAL_PLUGINS[number], repository: string, tag: string, asset: string) {
  return official.repository === repository && matchesReleaseTag(tag, official.tagPrefix) && pluginAsset(asset)?.id === official.id
}
export function githubRepository(input: string) {
  const value = input.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) || value.split('/').some(part => part === '.' || part === '..')) throw new HttpError('Enter a GitHub owner/repository', 400)
  return value
}

async function githubResponse(url: string, maxBytes: number, signal = AbortSignal.timeout(30_000)) {
  try {
    for (let redirects = 0; redirects < 5; redirects++) {
      const target = new URL(url)
      if (target.protocol !== 'https:' || !hosts.has(target.hostname) || target.port || target.username || target.password) throw new HttpError('Untrusted plugin download origin', 400)
      const response = await fetch(target, { redirect: 'manual', cache: 'no-store', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SlothVault-Plugins' }, signal })
      if ([301, 302, 303, 307, 308].includes(response.status)) { url = new URL(response.headers.get('location') ?? '', target).href; await response.body?.cancel(); continue }
      if (!response.ok) { await response.body?.cancel(); throw new HttpError(response.status === 403 || response.status === 429 ? 'GitHub rate limit exceeded' : 'GitHub plugin source is unavailable', 502) }
      if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new HttpError('Plugin download exceeds size limit', 413) }
      const chunks: Uint8Array[] = []; let size = 0
      if (!response.body) throw new HttpError('Empty plugin download', 502)
      const reader = response.body.getReader()
      try {
        for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > maxBytes) throw new HttpError('Plugin download exceeds size limit', 413); chunks.push(part.value) }
      } finally { await reader.cancel().catch(() => undefined) }
      return { bytes: Buffer.concat(chunks), link: response.headers.get('link') ?? '' }
    }
  } catch (error) {
    if (signal.aborted) throw new HttpError('GitHub plugin source request timed out', 504)
    if (error instanceof HttpError) throw error
    throw new HttpError('GitHub plugin source is unavailable', 502)
  }
  throw new HttpError('Too many GitHub redirects', 502)
}
export async function githubBytes(url: string, maxBytes: number) {
  return (await githubResponse(url, maxBytes)).bytes
}
function parseRelease(bytes: Buffer) {
  try { return releaseSchema.parse(JSON.parse(bytes.toString())) } catch { throw new HttpError('Invalid GitHub response', 502) }
}

export async function listPluginReleases(repository: string, prefix = '', pluginId?: string) {
  const repo = githubRepository(repository)
  let url = `https://api.github.com/repos/${repo}/releases?per_page=100`
  const signal = AbortSignal.timeout(30_000)
  const seen = new Set<string>()
  const releases: z.infer<typeof releaseSchema>[] = []
  for (let page = 0; ; page++) {
    if (page >= 10) throw new HttpError('GitHub plugin release scan limit reached; use a manual ZIP or a dedicated repository', 502)
    if (seen.has(url)) throw new HttpError('Invalid GitHub pagination', 502)
    seen.add(url)
    const response = await githubResponse(url, 2 * 1024 * 1024, signal)
    try { releases.push(...z.array(releaseSchema).max(100).parse(JSON.parse(response.bytes.toString()))) } catch { throw new HttpError('Invalid GitHub response', 502) }
    const next = /<([^>]+)>;\s*rel="next"/.exec(response.link)?.[1]
    if (!next) break
    let target: URL
    try { target = new URL(next) } catch { throw new HttpError('Invalid GitHub pagination', 502) }
    if (target.origin !== 'https://api.github.com' || target.username || target.password
      || (target.pathname.toLowerCase() !== `/repos/${repo}/releases`.toLowerCase() && !/^\/repositories\/\d+\/releases$/.test(target.pathname))) throw new HttpError('Invalid GitHub pagination', 502)
    url = target.href
  }
  const candidates = releases.filter(release => !release.draft && !release.prerelease && matchesReleaseTag(release.tag_name, prefix)
    && release.assets.filter(asset => asset.name === 'checksums.sha256').length === 1)
    .flatMap(release => release.assets.flatMap(asset => {
      const parsed = pluginAsset(asset.name)
      if (!parsed || (pluginId && parsed.id !== pluginId) || asset.size > MAX_PLUGIN_PACKAGE_BYTES
        || release.assets.filter(item => item.name === asset.name).length !== 1) return []
      return [{ repository: repo, tag: release.tag_name, notes: (release.body ?? '').slice(0, 10000), asset: asset.name, size: asset.size, version: parsed.version, publishedAt: Date.parse(release.published_at ?? '') || 0 }]
    }))
    .sort((a, b) => {
      const av = applicationVersion(a.tag), bv = applicationVersion(b.tag)
      if (av && bv) return semver.rcompare(av, bv)
      if (av || bv) return av ? -1 : 1
      return b.publishedAt - a.publishedAt || b.tag.localeCompare(a.tag)
    })
  const unique = new Map<string, typeof candidates[number]>()
  for (const item of candidates) if (!unique.has(item.asset)) unique.set(item.asset, item)
  return [...unique.values()].sort((a, b) => semver.rcompare(a.version, b.version) || a.asset.localeCompare(b.asset))
    .map(({ repository, tag, notes, asset, size, version }) => ({ repository, tag, notes, asset, size, version }))
}
export async function downloadPluginRelease(repository: string, tag: string, asset: string) {
  const repo = githubRepository(repository)
  if (tag.length > 150 || !/^[A-Za-z0-9._-]+$/.test(tag) || !pluginAsset(asset)) throw new HttpError('Invalid plugin release selector', 400)
  const release = parseRelease(await githubBytes(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, 2 * 1024 * 1024))
  if (release.tag_name !== tag) throw new HttpError('GitHub release tag mismatch', 502)
  if (release.draft || release.prerelease) throw new HttpError('Only stable releases can be installed', 400)
  const items = release.assets.filter(item => item.name === asset)
  const checksums = release.assets.filter(item => item.name === 'checksums.sha256')
  if (items.length !== 1 || checksums.length !== 1) throw new HttpError('Release package or checksums.sha256 is missing or duplicated', 400)
  const hashes = (await githubBytes(checksums[0].browser_download_url, 64 * 1024)).toString()
  const matches = hashes.split(/\r?\n/).flatMap(line => {
    const match = /^([a-fA-F0-9]{64})[ \t]+\*?(.+)$/.exec(line.trim())
    return match?.[2] === asset ? [match[1].toLowerCase()] : []
  })
  if (matches.length !== 1) throw new HttpError('Release package SHA-256 entry is missing or duplicated', 400)
  const buffer = await githubBytes(items[0].browser_download_url, MAX_PLUGIN_PACKAGE_BYTES)
  if (sha256(buffer) !== matches[0]) throw new HttpError('Release package SHA-256 mismatch', 400)
  return buffer
}
