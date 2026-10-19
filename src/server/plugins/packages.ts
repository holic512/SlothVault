/**
 * @file packages.ts
 * @project SlothVault
 * @module Plugin Package Storage
 * @description Verifies bounded, hash-complete ZIP packages before registering immutable private assets.
 * @logic Inspect all paths and file digests without importing code; atomically publish a content-addressed directory.
 * @dependencies ZIP validator, app-data, plugin protocol, node crypto/fs
 * @index_tags plugins,packages,sha256,zip,installation
 * @author holic512
 */
import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import semver from 'semver'
import packageJson from '../../../package.json'
import { pluginManifestSchema, pluginIdSchema, PLUGIN_API_VERSION, assetPathSchema, type PluginManifest } from '@slothvault/plugin-sdk/protocol'
import { appDataPath } from '@/server/config/app-data'
import { HttpError } from '@/server/http/errors'
import { validateZipArchive } from '@/server/services/admin-backup/zip-validation'

export const MAX_PLUGIN_PACKAGE_BYTES = 32 * 1024 * 1024
export const MAX_PLUGIN_EXPANDED_BYTES = 96 * 1024 * 1024
export function pluginRoot(id?: string) { return id ? resolve(appDataPath(), 'plugins', pluginIdSchema.parse(id)) : resolve(appDataPath(), 'plugins') }
export function packageRoot(digest: string, id: string) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new HttpError('Invalid package digest', 400)
  return resolve(pluginRoot(id), 'packages', digest)
}
export function packageAsset(digest: string, path: string, id: string) { return resolve(packageRoot(digest, id), assetPathSchema.parse(path)) }
export const sourceMappingSchema = z.object({
  format: z.literal('source-v1'),
  server: assetPathSchema.optional(),
  client: z.record(z.string(), assetPathSchema).default({}),
  css: z.record(z.string(), assetPathSchema).default({}),
}).strict()
export function sha256(buffer: Buffer | string) { return createHash('sha256').update(buffer).digest('hex') }
export function assertCompatible(manifest: PluginManifest) {
  for (const [current, range] of [[packageJson.version, manifest.engines.slothvault], [PLUGIN_API_VERSION, manifest.engines.sdk], [process.versions.node, manifest.engines.node]]) {
    if (!semver.satisfies(current, range)) throw new HttpError('Plugin version is incompatible with this host', 409, 409, { reason: 'PLUGIN_INCOMPATIBLE' })
  }
}
export async function verifyPluginPackage(buffer: Buffer) {
  if (buffer.length > MAX_PLUGIN_PACKAGE_BYTES) throw new HttpError('Plugin package is too large', 413)
  const entries = await validateZipArchive(buffer)
  if (entries.length > 1000 || entries.reduce((n, entry) => n + entry.declaredSize, 0) > MAX_PLUGIN_EXPANDED_BYTES) throw new HttpError('Plugin package expansion limit exceeded', 413)
  const files = new Map<string, Buffer>()
  let total = 0
  for (const item of entries) {
    if (item.kind !== 'file') continue
    assetPathSchema.parse(item.relativePath)
    const chunks: Buffer[] = []; let size = 0
    for await (const chunk of item.entry.stream()) {
      const bytes = Buffer.from(chunk); size += bytes.length; total += bytes.length
      if (total > MAX_PLUGIN_EXPANDED_BYTES || size > item.declaredSize) throw new HttpError('Plugin package expansion limit exceeded', 413)
      chunks.push(bytes)
    }
    if (size !== item.declaredSize) throw new HttpError('Invalid plugin file size', 400)
    files.set(item.relativePath, Buffer.concat(chunks))
  }
  try {
    const hashes = z.object({ algorithm: z.literal('sha256'), files: z.record(assetPathSchema, z.string().regex(/^[a-f0-9]{64}$/)) }).strict().parse(JSON.parse(files.get('hashmanifest.json')?.toString() ?? 'null'))
    if (Object.keys(hashes.files).length !== files.size - 1 || Object.hasOwn(hashes.files, 'hashmanifest.json')) throw new Error('Incomplete hash manifest')
    for (const [name, bytes] of files) if (name !== 'hashmanifest.json' && hashes.files[name] !== sha256(bytes)) throw new Error('Hash mismatch')
    if ((files.get('plugin.json')?.length ?? 0) > 512000) throw new Error('Manifest is too large')
    const manifest = pluginManifestSchema.parse(JSON.parse(files.get('plugin.json')?.toString() ?? 'null'))
    assertCompatible(manifest)
    if (!files.has('plugin.build.json')) throw new HttpError('Upload a source-v1 ZIP; prebuilt plugin packages are no longer supported', 400)
    const mapping = sourceMappingSchema.parse(JSON.parse(files.get('plugin.build.json')!.toString()))
    for (const path of files.keys()) if (!['plugin.json', 'plugin.build.json', 'hashmanifest.json'].includes(path) && (!path.startsWith('src/') || !/\.(?:ts|tsx|js|jsx|mjs|json|css)$/.test(path) || path.split('/').some(part => part.startsWith('.') || part === 'node_modules'))) throw new Error('Only source assets are allowed')
    const entries = [manifest.server ? mapping.server : undefined, ...manifest.ui.flatMap(ui => [mapping.client[ui.key], ui.css ? mapping.css[ui.key] : undefined])]
    if (manifest.server && !mapping.server || manifest.ui.some(ui => !mapping.client[ui.key] || (ui.css && !mapping.css[ui.key]))) throw new Error('Missing source entry mapping')
    for (const path of entries.filter((p): p is string => !!p)) if (!path.startsWith('src/') || !files.has(path)) throw new Error('Missing source entrypoint')
    return { manifest, digest: sha256(buffer), files }
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError('Invalid plugin manifest, entrypoint or SHA-256 hash', 400, 400, { reason: 'PLUGIN_INVALID_PACKAGE' })
  }
}
export async function stagePluginPackage(buffer: Buffer, replaceExisting = false) {
  const verified = await verifyPluginPackage(buffer)
  const target = packageRoot(verified.digest, verified.manifest.id)
  await mkdir(resolve(pluginRoot(verified.manifest.id), 'archives'), { recursive: true, mode: 0o700 })
  const archive = resolve(pluginRoot(verified.manifest.id), 'archives', verified.digest + '.zip')
  const temporaryArchive = resolve(pluginRoot(verified.manifest.id), 'archives', `${verified.digest}.${randomUUID()}.tmp`)
  try { await writeFile(temporaryArchive, buffer, { mode: 0o600, flag: 'wx' }); await rename(temporaryArchive, archive) }
  finally { await rm(temporaryArchive, { force: true }) }
  if (!replaceExisting) {
    try {
      await stat(target)
      const intact = (await Promise.all([...verified.files].map(async ([name, bytes]) => {
        const path = resolve(target, name)
        return (await stat(path)).size === bytes.length && sha256(await readFile(path)) === sha256(bytes)
      }))).every(Boolean)
      if (intact) return verified
      replaceExisting = true
    } catch { replaceExisting = true }
  }
  const temporary = resolve(pluginRoot(verified.manifest.id), 'staging', randomUUID())
  await mkdir(temporary, { recursive: true, mode: 0o700 })
  try {
    for (const [name, bytes] of verified.files) {
      const path = resolve(temporary, name); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, bytes, { mode: 0o600 })
    }
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    if (replaceExisting) await rm(target, { recursive: true, force: true })
    try { await rename(temporary, target) } catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }
    return verified
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
export async function verifyInstalledPackage(digest: string, manifest: PluginManifest) {
  const verified = await verifyPluginPackage(await stagedPackageBytes(digest, manifest.id))
  if (verified.digest !== digest || JSON.stringify(verified.manifest) !== JSON.stringify(manifest)) throw new HttpError('Installed source differs from the registered digest', 503)
  for (const [name, bytes] of verified.files) {
    const path = packageAsset(digest, name, manifest.id)
    if ((await stat(path)).size !== bytes.length || sha256(await readFile(path)) !== sha256(bytes)) throw new HttpError('Installed plugin sources were modified', 503)
  }
}
export async function packageExists(digest: string, id: string) {
  try { await stat(packageAsset(digest, 'plugin.json', id)); await stat(resolve(pluginRoot(id), 'archives', digest + '.zip')); return true } catch { return false }
}
export async function stagedPackageBytes(digest: string, id: string) {
  packageRoot(digest, id)
  const path = resolve(pluginRoot(id), 'archives', digest + '.zip')
  if ((await stat(path)).size > MAX_PLUGIN_PACKAGE_BYTES) throw new HttpError('Stored source archive exceeds size limit', 413)
  return readFile(path)
}
export async function readVerifiedPluginAsset(digest: string, manifest: PluginManifest, path: string) {
  const { compiledAsset, ensureCompiledPlugin, verifyCompiledAsset } = await import('./compiler')
  await ensureCompiledPlugin(digest, manifest)
  await verifyCompiledAsset(digest, manifest, path)
  return readFile(compiledAsset(digest, manifest.id, path))
}
