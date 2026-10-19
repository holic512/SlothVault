/**
 * @file sources.ts
 * @project SlothVault
 * @module GitHub Plugin Source
 * @description Discovers stable GitHub Release packages without cloning or executing repository source.
 * @logic Restrict repository syntax and redirect origins, bound downloads, and verify release checksums before staging.
 * @dependencies fetch, plugin package limits, node crypto
 * @index_tags plugins,github,releases,download,ssrf
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
export function githubRepository(input: string) {
  const value = input.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) || value.split('/').some(part => part === '.' || part === '..')) throw new HttpError('Enter a GitHub owner/repository', 400)
  return value
}
export async function githubBytes(url: string, maxBytes: number) {
  for (let redirects = 0; redirects < 5; redirects++) {
    const target = new URL(url)
    if (target.protocol !== 'https:' || !hosts.has(target.hostname) || target.port || target.username || target.password) throw new HttpError('Untrusted plugin download origin', 400)
    const response = await fetch(target, { redirect: 'manual', cache: 'no-store', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SlothVault-Plugins' }, signal: AbortSignal.timeout(30_000) })
    if ([301, 302, 303, 307, 308].includes(response.status)) { url = new URL(response.headers.get('location') ?? '', target).href; await response.body?.cancel(); continue }
    if (!response.ok) throw new HttpError(response.status === 403 || response.status === 429 ? 'GitHub rate limit exceeded' : 'GitHub plugin source is unavailable', 502)
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new HttpError('Plugin download exceeds size limit', 413) }
    const chunks: Uint8Array[] = []; let size = 0
    if (!response.body) throw new HttpError('Empty plugin download', 502)
    const reader = response.body.getReader()
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > maxBytes) throw new HttpError('Plugin download exceeds size limit', 413); chunks.push(part.value) }
    } finally { await reader.cancel().catch(() => undefined) }
    return Buffer.concat(chunks)
  }
  throw new HttpError('Too many GitHub redirects', 502)
}
export async function listPluginReleases(repository: string, prefix = '', pluginId?: string) {
  const repo = githubRepository(repository)
  const releases = JSON.parse((await githubBytes(`https://api.github.com/repos/${repo}/releases?per_page=100`, 2 * 1024 * 1024)).toString()) as { tag_name: string; draft: boolean; prerelease: boolean; body: string | null; assets: { name: string; browser_download_url: string; size: number }[] }[]
  if (!Array.isArray(releases)) throw new HttpError('Invalid GitHub response', 502)
  return releases.filter(r => !r.draft && !r.prerelease && r.tag_name.startsWith(prefix)).flatMap(r => r.assets.filter(a => /^slothvault-plugin-[a-z0-9.-]+-\d+\.\d+\.\d+\.zip$/.test(a.name) && (!pluginId || a.name.startsWith(`slothvault-plugin-${pluginId}-`))).map(a => ({ repository: repo, tag: r.tag_name, notes: (r.body ?? '').slice(0, 10000), asset: a.name, size: a.size, version: /-(\d+\.\d+\.\d+)\.zip$/.exec(a.name)![1] }))).sort((a, b) => semver.rcompare(a.version, b.version))
}
export async function downloadPluginRelease(repository: string, tag: string, asset: string) {
  const repo = githubRepository(repository)
  if (tag.length > 150 || !/^[A-Za-z0-9._-]+$/.test(tag)) throw new HttpError('Invalid release tag', 400)
  const release = JSON.parse((await githubBytes(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, 2 * 1024 * 1024)).toString()) as { draft: boolean; prerelease: boolean; assets: { name: string; browser_download_url: string }[] }
  if (release.draft || release.prerelease) throw new HttpError('Only stable releases can be installed', 400)
  const item = release.assets.find(a => a.name === asset && asset.endsWith('.zip')); const checksum = release.assets.find(a => a.name === 'checksums.sha256')
  if (!item || !checksum) throw new HttpError('Release package or checksums.sha256 is missing', 400)
  const hashes = (await githubBytes(checksum.browser_download_url, 64 * 1024)).toString()
  const expected = hashes.split(/\r?\n/).map(line => line.trim().split(/\s+\*?/)).find(parts => parts[1] === asset)?.[0]
  const buffer = await githubBytes(item.browser_download_url, MAX_PLUGIN_PACKAGE_BYTES)
  if (!expected || sha256(buffer) !== expected) throw new HttpError('Release package SHA-256 mismatch', 400)
  return buffer
}
