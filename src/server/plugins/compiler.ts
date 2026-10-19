/**
 * @file compiler.ts
 * @project SlothVault
 * @module Plugin Compilation Cache
 * @description Compiles trusted source packages in a bounded worker and atomically publishes authenticated cache entries.
 * @logic Deduplicate compilation, verify source identity before executing the compiler, and retain old cache/version pointers on failure.
 * @dependencies worker_threads, package verifier, master-key, filesystem
 * @index_tags plugins,compiler,cache,persistence
 * @author holic512
 */
import 'server-only'
import packageJson from '../../../package.json'
import { Worker } from 'node:worker_threads'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assetPathSchema, type PluginManifest } from '@slothvault/plugin-sdk/protocol'
import { getMasterKey } from '@/server/config/master-key'
import { HttpError } from '@/server/http/errors'
import { MAX_PLUGIN_EXPANDED_BYTES, packageRoot, pluginRoot, sha256, verifyInstalledPackage } from './packages'
const COMPILER_VERSION = `source-v1-1-${packageJson.version}`
const state = globalThis as unknown as { slothVaultPluginCompilations?: Map<string, Promise<void>> }
const compiling = state.slothVaultPluginCompilations ??= new Map()
const cache = (digest: string, id: string) => { packageRoot(digest, id); return resolve(pluginRoot(id), 'compiled', `${digest}-${COMPILER_VERSION}`) }
export const compiledAsset = (digest: string, id: string, path: string) => resolve(cache(digest, id), assetPathSchema.parse(path))
const sign = (data: string) => createHmac('sha256', getMasterKey()).update(`plugins:compiled:${data}`).digest('hex')
async function hashes(digest: string, manifest: PluginManifest): Promise<Record<string, string>> {
  const envelope = JSON.parse(await readFile(resolve(cache(digest, manifest.id), 'receipt.json'), 'utf8')) as { data: string; signature: string }
  if (sign(envelope.data) !== envelope.signature) throw new Error('Compiled cache signature mismatch')
  const receipt = JSON.parse(envelope.data)
  if (receipt.digest !== digest || receipt.compiler !== COMPILER_VERSION || receipt.pluginId !== manifest.id) throw new Error('Compiled cache identity mismatch')
  return receipt.files
}
export async function verifyCompiledAsset(digest: string, manifest: PluginManifest, path: string) {
  const expected = (await hashes(digest, manifest))[path]
  const file = compiledAsset(digest, manifest.id, path)
  if (!expected || (await stat(file)).size > MAX_PLUGIN_EXPANDED_BYTES || sha256(await readFile(file)) !== expected) throw new HttpError('Compiled plugin asset was modified', 503)
}
export async function ensureCompiledPlugin(digest: string, manifest: PluginManifest) {
  const key = `${manifest.id}/${digest}`
  if (compiling.has(key)) return compiling.get(key)!
  try {
    await hashes(digest, manifest)
    const entries = [manifest.server, ...manifest.ui.flatMap(ui => [ui.asset, ui.css])].filter((path): path is string => !!path)
    for (const path of entries) await verifyCompiledAsset(digest, manifest, path)
    return
  } catch { /* Missing, stale, or corrupted cache is rebuilt from verified source. */ }
  if (compiling.has(key)) return compiling.get(key)!
  if (compiling.size) throw new HttpError('Another plugin is compiling; retry after it finishes', 409)
  const task = compile(digest, manifest).finally(() => compiling.delete(key))
  compiling.set(key, task)
  return task
}
async function compile(digest: string, manifest: PluginManifest) {
  await verifyInstalledPackage(digest, manifest)
  const target = cache(digest, manifest.id), output = resolve(pluginRoot(manifest.id), 'staging', `compile-${randomUUID()}`)
  await mkdir(output, { recursive: true, mode: 0o700 })
  let worker: Worker | undefined
  try {
    worker = new Worker(resolve(/* turbopackIgnore: true */ process.cwd(), 'generated/plugin-runtime/compiler.mjs'), {
      workerData: { directory: packageRoot(digest, manifest.id), output, manifest, sdk: resolve(process.cwd(), 'generated/plugin-runtime/sdk') },
      resourceLimits: { maxOldGenerationSizeMb: 384 },
    })
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new HttpError('Plugin source compilation timed out', 504)), 60_000)
      const finish = (error?: Error) => { clearTimeout(timer); if (error) fail(error); else done() }
      worker!.once('message', result => finish(result.ok ? undefined : new HttpError(`Plugin compilation failed: ${result.error}`, 400)))
      worker!.once('error', () => finish(new HttpError('Plugin compiler worker failed', 503)))
      worker!.once('exit', () => finish(new HttpError('Plugin compiler stopped', 503)))
    })
    const files: Record<string, string> = {}
    for (const path of [manifest.server, ...manifest.ui.flatMap(ui => [ui.asset, ui.css])].filter((path): path is string => !!path)) {
      const file = resolve(output, path)
      if ((await stat(file)).size > MAX_PLUGIN_EXPANDED_BYTES) throw new HttpError('Compiled plugin is too large', 413)
      files[path] = sha256(await readFile(file))
    }
    const data = JSON.stringify({ digest, pluginId: manifest.id, compiler: COMPILER_VERSION, files })
    await writeFile(resolve(output, 'receipt.json'), JSON.stringify({ data, signature: sign(data) }), { mode: 0o600 })
    await mkdir(resolve(pluginRoot(manifest.id), 'compiled'), { recursive: true, mode: 0o700 })
    await rm(target, { recursive: true, force: true })
    await rename(output, target)
  } finally { await worker?.terminate(); await rm(output, { recursive: true, force: true }) }
}
