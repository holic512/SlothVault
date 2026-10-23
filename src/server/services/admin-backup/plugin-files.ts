/**
 * @file plugin-files.ts
 * @project SlothVault
 * @module Private Plugin Backup Files
 * @description Maps private immutable files into a reserved backup namespace, independently of executable plugin packages.
 * @logic Index bounded file manifests, verify each owner/UUID/byte digest and portable reference, and enumerate only published files.
 * @dependencies private plugin storage, plugin backup validation, disk record store
 * @index_tags backup,plugins,files,manifest,sha256
 * @author holic512
 */
import 'server-only'
import { resolve } from 'node:path'
import { pluginIdSchema } from '@slothvault/plugin-sdk/protocol'
import { listPluginFiles, pluginFileMetadataSchema, type PluginFileMetadata } from '@/server/plugins/files'
import { validatePluginFileReferences } from '@/server/plugins/backup'
import { HttpError } from '@/server/http/errors'
import type { RecordStore } from './record-store'
import type { StorageTreeEntry } from './files-common'

export const PLUGIN_FILES_ARCHIVE_ROOT = '__plugin_files'
function invalid(): never { throw new HttpError('Invalid private plugin files in backup', 400, 400, { reason: 'BACKUP_PLUGIN_FILE_MISMATCH' }) }
export function privateFilePath(path: string) {
  const parts = path.split('/')
  if (parts[0] !== PLUGIN_FILES_ARCHIVE_ROOT) return null
  if (parts.length === 1) return { kind: 'directory' as const }
  if (!pluginIdSchema.safeParse(parts[1]).success) invalid()
  if (parts.length === 2) return { kind: 'directory' as const }
  if (!pluginFileMetadataSchema.shape.id.safeParse(parts[2]).success) invalid()
  if (parts.length === 3) return { kind: 'directory' as const }
  if (parts.length !== 4 || !['bytes', 'metadata.json'].includes(parts[3])) invalid()
  return { kind: 'file' as const, pluginId: parts[1], id: parts[2], metadata: parts[3] === 'metadata.json' }
}
export function indexPrivateManifest(store: RecordStore, path: string, contents: Buffer) {
  const entry = privateFilePath(path)
  if (!entry || entry.kind !== 'file' || !entry.metadata || contents.length > 4096) invalid()
  let metadata: PluginFileMetadata
  try { metadata = pluginFileMetadataSchema.parse(JSON.parse(contents.toString('utf8'))) } catch { invalid() }
  if (metadata.id !== entry.id) invalid()
  store.put('$pluginFiles', { ...metadata, id: `${entry.pluginId}:${entry.id}`, fileId: entry.id, pluginId: entry.pluginId })
}
export function checkPrivateFiles(store: RecordStore) {
  const owners = store.set()
  for (const row of store.iterate<{ pluginId: string }>('pluginInstallations')) owners.add(row.pluginId)
  const lookup = (pluginId: string, id: string) => {
    const file = store.get<PluginFileMetadata & { fileId: string }>('$pluginFiles', `${pluginId}:${id}`)
    return file ? { id: file.fileId, name: file.name, size: file.size, sha256: file.sha256, createdAt: file.createdAt } : undefined
  }
  for (const row of store.iterate<{ path: string; kind: string; size: number; sha256: string | null }>('$files')) {
    const entry = privateFilePath(row.path)
    if (!entry) continue
    if (row.kind !== entry.kind) invalid()
    if (entry.kind !== 'file') continue
    if (!owners.has(entry.pluginId)) invalid()
    const metadata = lookup(entry.pluginId, entry.id)
    if (!metadata) invalid()
    const bytes = store.get<{kind: string; size: number; sha256: string}>('$files', `${PLUGIN_FILES_ARCHIVE_ROOT}/${entry.pluginId}/${entry.id}/bytes`)
    if (!bytes || bytes.kind !== 'file' || String(bytes.size) !== metadata.size || bytes.sha256 !== metadata.sha256) invalid()
  }
  validatePluginFileReferences(store.iterate('pluginRows'), lookup)
}
export async function* privateBackupEntries(): AsyncGenerator<StorageTreeEntry> {
  // Only the two host-owned file assets are included; executable packages and unfinished uploads are excluded.
  const directories = new Set<string>()
  for await (const file of listPluginFiles()) {
    const base = `${PLUGIN_FILES_ARCHIVE_ROOT}/${file.pluginId}/${file.metadata.id}`
    for (const relativePath of [PLUGIN_FILES_ARCHIVE_ROOT, `${PLUGIN_FILES_ARCHIVE_ROOT}/${file.pluginId}`, base]) if (!directories.has(relativePath)) {
      directories.add(relativePath)
      yield { absolutePath: file.directory, relativePath, kind: 'directory' }
    }
    for (const name of ['bytes', 'metadata.json']) yield {
      absolutePath: resolve(file.directory, name), relativePath: `${base}/${name}`, kind: 'file',
    }
  }
}
