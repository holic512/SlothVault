/**
 * @file files.ts
 * @project SlothVault
 * @module Private Plugin Files
 * @description Stores immutable plugin-owned bytes outside public uploads and serves verified streams.
 * @logic Stream into a private staging directory, fsync bytes and metadata, atomically publish a UUID directory; validate ownership and SHA256 before reads and ZIP streaming.
 * @dependencies Node filesystem/streams/crypto, Archiver, plugin protocol, app-data
 * @index_tags plugins,files,private,stream,sha256,archive
 * @author holic512
 */
import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, rm, type FileHandle } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import archiver from 'archiver'
import { z } from 'zod'
import { pluginIdSchema } from '@slothvault/plugin-sdk/protocol'
import { appDataPath } from '@/server/config/app-data'
import { HttpError } from '@/server/http/errors'

export const PLUGIN_FILE_MAX_BYTES = 100 * 1024 * 1024
export const pluginFileMetadataSchema = z.object({
  id: z.string().uuid(), name: z.string().min(1).max(255).refine(value => !/[\x00-\x1f\x7f/\\]/.test(value)),
  size: z.string().regex(/^(0|[1-9]\d*)$/).refine(value => BigInt(value) <= BigInt(PLUGIN_FILE_MAX_BYTES)),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().datetime({ offset: true }),
}).strict()
export type PluginFileMetadata = z.infer<typeof pluginFileMetadataSchema>
export type PluginArchiveInput = { name: string; entries: { path: string; fileId?: string; text?: string }[] }
const uuid = z.string().uuid()
export function pluginFilesRoot() { return resolve(appDataPath(), 'plugin-files') }
function invalid(message = 'Invalid private plugin file'): never { throw new HttpError(message, 400) }
function checkedPlugin(pluginId: string) { if (!pluginIdSchema.safeParse(pluginId).success) invalid(); return pluginId }
function checkedId(id: string) { if (!uuid.safeParse(id).success) invalid(); return id }
function checkedName(name: string) { if (!pluginFileMetadataSchema.shape.name.safeParse(name).success) invalid('Invalid filename'); return name }
async function directory(path: string, create = false) {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new HttpError('Unsafe private file directory', 409)
}
async function ownerRoot(pluginId: string, create = false) {
  checkedPlugin(pluginId)
  // Deployment controls appDataPath; all descendants are checked, including the storage root.
  await directory(appDataPath(), create)
  await directory(pluginFilesRoot(), create)
  const root = resolve(pluginFilesRoot(), pluginId)
  await directory(root, create)
  return root
}
async function regularFile(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try { const info = await handle.stat(); if (!info.isFile() || info.nlink !== 1) throw new HttpError('Unsafe private file', 409); return handle }
  catch (error) { await handle.close(); throw error }
}
async function syncDirectory(path: string) { const handle = await open(path, 'r'); try { await handle.sync() } finally { await handle.close() } }
function notFound(error: unknown): never {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError('Plugin file not found', 404)
  throw error
}
/** Host holds its maintenance lock across authorization, publication, DB completion and compensation. */
export async function savePluginUpload(pluginId: string, file: { name: string; size: number; stream: () => ReadableStream<Uint8Array> }): Promise<PluginFileMetadata> {
  checkedName(file.name)
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > PLUGIN_FILE_MAX_BYTES) throw new HttpError('Plugin upload exceeds 100 MiB', 413)
  const root = await ownerRoot(pluginId, true), id = randomUUID(), stage = resolve(root, `.upload-${id}`), destination = resolve(root, id)
  await mkdir(stage, { mode: 0o700 })
  let published = false
  try {
    const handle = await open(resolve(stage, 'bytes'), 'wx', 0o600), hash = createHash('sha256')
    let size = 0
    try {
      const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length
        if (size > PLUGIN_FILE_MAX_BYTES || size > file.size) { callback(new HttpError('Plugin upload exceeds declared size or 100 MiB', 413)); return }
        hash.update(chunk); callback(null, chunk)
      } })
      await pipeline(Readable.fromWeb(file.stream() as import('node:stream/web').ReadableStream<Uint8Array>), limiter, new Writable({ write(chunk: Buffer, _encoding, callback) { handle.writeFile(chunk).then(() => callback(), callback) } }))
      if (size !== file.size) throw new HttpError('Plugin upload size mismatch', 400)
      await handle.sync()
    } finally { await handle.close() }
    const metadata = pluginFileMetadataSchema.parse({ id, name: file.name, size: String(size), sha256: hash.digest('hex'), createdAt: new Date().toISOString() })
    const meta = await open(resolve(stage, 'metadata.json'), 'wx', 0o600)
    try { await meta.writeFile(JSON.stringify(metadata)); await meta.sync() } finally { await meta.close() }
    await syncDirectory(stage); await rename(stage, destination); published = true; await syncDirectory(root)
    return metadata
  } catch (error) { await rm(published ? destination : stage, { recursive: true, force: true }); throw error }
}
/** Intended only for compensating a just-created upload whose completion handler failed. */
export async function deletePluginUpload(pluginId: string, id: string): Promise<void> {
  checkedId(id)
  try {
    const root = await ownerRoot(pluginId), path = resolve(root, id)
    await directory(path); await rm(path, { recursive: true }); await syncDirectory(root)
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}
async function verifiedFile(pluginId: string, id: string): Promise<{ metadata: PluginFileMetadata; handle: FileHandle }> {
  checkedId(id)
  try {
    const path = resolve(await ownerRoot(pluginId), id)
    await directory(path)
    const meta = await regularFile(resolve(path, 'metadata.json'))
    let metadata: PluginFileMetadata
    try {
      if ((await meta.stat()).size > 4096) invalid()
      metadata = pluginFileMetadataSchema.parse(JSON.parse(await meta.readFile('utf8')))
      if (metadata.id !== id) invalid()
    } finally { await meta.close() }
    const handle = await regularFile(resolve(path, 'bytes'))
    try {
      if ((await handle.stat()).size !== Number(metadata.size)) throw new HttpError('Plugin file integrity mismatch', 409)
      const hash = createHash('sha256')
      const buffer = Buffer.alloc(65536)
      let position = 0
      while (true) { const { bytesRead } = await handle.read(buffer, 0, buffer.length, position); if (!bytesRead) break; hash.update(buffer.subarray(0, bytesRead)); position += bytesRead }
      if (hash.digest('hex') !== metadata.sha256) throw new HttpError('Plugin file integrity mismatch', 409)
      return { metadata, handle }
    } catch (error) { await handle.close(); throw error }
  } catch (error) { notFound(error) }
}
export async function inspectPluginFile(pluginId: string, id: string): Promise<PluginFileMetadata> {
  const { metadata, handle } = await verifiedFile(pluginId, id)
  await handle.close(); return metadata
}
export async function ensurePluginFiles(pluginId: string, ids: string[]): Promise<PluginFileMetadata[]> {
  if (!Array.isArray(ids) || ids.length > 1000) invalid('Too many plugin files')
  const results: PluginFileMetadata[] = []
  for (const id of ids) results.push(await inspectPluginFile(pluginId, id))
  return results
}
function headers(name: string, contentType: string) {
  checkedName(name)
  return { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, value => '%' + value.charCodeAt(0).toString(16))}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
}
export async function streamPluginFile(pluginId: string, id: string, name?: string): Promise<Response> {
  if (name !== undefined) checkedName(name)
  const { metadata, handle } = await verifiedFile(pluginId, id)
  try {
    const stream = handle.createReadStream({ start: 0, autoClose: true })
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers: { ...headers(name ?? metadata.name, 'application/octet-stream'), 'Content-Length': metadata.size } })
  } catch (error) { await handle.close(); throw error }
}
function archivePath(path: string) {
  if (typeof path !== 'string' || Buffer.byteLength(path) > 1024 || /[\\\x00-\x1f\x7f:]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || part.endsWith('.') || part.endsWith(' '))) invalid('Unsafe plugin archive path')
  return path
}
export async function pluginArchive(pluginId: string, input: PluginArchiveInput): Promise<Response> {
  checkedPlugin(pluginId); checkedName(input.name)
  if (!Array.isArray(input.entries) || input.entries.length > 1000) invalid('Too many archive entries')
  const paths = new Set<string>(), files = new Set<string>()
  let textBytes = 0
  for (const entry of input.entries) {
    const path = archivePath(entry.path).normalize('NFC').toLowerCase()
    if (paths.has(path) || [...paths].some(other => other.startsWith(path + '/') || path.startsWith(other + '/'))) invalid('Duplicate or conflicting archive path')
    paths.add(path)
    if ((entry.fileId !== undefined) === (entry.text !== undefined)) invalid('Archive entry requires exactly one fileId or text')
    if (entry.fileId !== undefined) files.add(checkedId(entry.fileId))
    if (entry.text !== undefined) {
      if (typeof entry.text !== 'string') invalid()
      textBytes += Buffer.byteLength(entry.text)
      if (textBytes > 8 * 1024 * 1024) invalid('Archive text is too large')
    }
  }
  // Reject missing/corrupt/cross-plugin inputs before sending HTTP headers. Reopen lazily to bound descriptors.
  await ensurePluginFiles(pluginId, [...files])
  const archive = archiver('zip', { forceZip64: true, zlib: { level: 1 } })
  const active = new Set<Readable>()
  archive.on('warning', error => archive.destroy(error))
  archive.once('close', () => { for (const source of active) source.destroy() })
  void (async () => {
    try {
      for (const entry of input.entries) {
        if (archive.destroyed) return
        if (entry.fileId !== undefined) {
          const { handle } = await verifiedFile(pluginId, entry.fileId)
          if (archive.destroyed) { await handle.close(); return }
          const stream = handle.createReadStream({ start: 0, autoClose: true })
          active.add(stream)
          stream.once('close', () => active.delete(stream))
          stream.once('error', error => archive.destroy(error))
          // Wait until this entry has drained before opening the next file.
          const appended = new Promise<void>((resolve, reject) => {
            const done = () => { cleanup(); resolve() }, fail = (error: Error) => { cleanup(); reject(error) }, closed = () => { cleanup(); reject(new Error('Archive cancelled')) }
            const cleanup = () => { archive.off('entry', done); archive.off('error', fail); archive.off('close', closed) }
            archive.once('entry', done); archive.once('error', fail); archive.once('close', closed)
          })
          archive.append(stream, { name: entry.path }); await appended
        } else archive.append(entry.text!, { name: entry.path })
      }
      await archive.finalize()
    } catch (error) { archive.destroy(error as Error) }
  })()
  return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, { headers: headers(input.name, 'application/zip') })
}
/** Backup-only enumeration: never expose these paths through plugin RPC or responses. */
export async function* listPluginFiles(): AsyncGenerator<{ pluginId: string; metadata: PluginFileMetadata; directory: string }> {
  try { await directory(pluginFilesRoot()) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  for (const pluginId of await readdir(pluginFilesRoot())) {
    checkedPlugin(pluginId)
    const root = await ownerRoot(pluginId)
    for (const id of await readdir(root)) {
      if (/^\.upload-[a-f0-9-]{36}$/.test(id)) continue
      const metadata = await inspectPluginFile(pluginId, id), path = resolve(root, id)
      if ((await readdir(path)).sort().join(',') !== 'bytes,metadata.json') invalid('Unexpected plugin file contents')
      yield { pluginId, metadata, directory: path }
    }
  }
}
