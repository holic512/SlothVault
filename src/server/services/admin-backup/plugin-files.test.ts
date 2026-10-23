import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RecordStore } from './record-store'
import { checkPrivateFiles, indexPrivateManifest, PLUGIN_FILES_ARCHIVE_ROOT, privateFilePath } from './plugin-files'

const pluginId = 'test.backup'
const metadata = {
  id: randomUUID(), name: 'source.txt', size: '6',
  sha256: createHash('sha256').update('frozen').digest('hex'), createdAt: '2026-10-23T00:00:00.000Z',
}
const base = `${PLUGIN_FILES_ARCHIVE_ROOT}/${pluginId}/${metadata.id}`
let directory: string, store: RecordStore
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sv-private-backup-'))
  store = new RecordStore(join(directory, 'index.sqlite'))
  store.put('pluginInstallations', { id: '1', pluginId })
})
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })
function addFile(options: { bytes?: boolean; manifest?: boolean; size?: number; sha256?: string; owner?: string } = {}) {
  const path = options.owner ? `${PLUGIN_FILES_ARCHIVE_ROOT}/${options.owner}/${metadata.id}` : base
  if (options.manifest !== false) {
    const contents = Buffer.from(JSON.stringify(metadata))
    indexPrivateManifest(store, `${path}/metadata.json`, contents)
    store.put('$files', { id: `${path}/metadata.json`, path: `${path}/metadata.json`, kind: 'file', size: contents.length, sha256: createHash('sha256').update(contents).digest('hex') })
  }
  if (options.bytes !== false) store.put('$files', { id: `${path}/bytes`, path: `${path}/bytes`, kind: 'file', size: options.size ?? 6, sha256: options.sha256 ?? metadata.sha256 })
}
function row(value: unknown, owner = pluginId) { store.put('pluginRows', { id: '1', pluginId: owner, rowJson: JSON.stringify(value) }) }

describe('private plugin backup inventories', () => {
  it('validates immutable bytes and nested portable JSON file references without business code', () => {
    addFile()
    row({ file_id: metadata.id, fileIds: [metadata.id], snapshot: JSON.stringify({ attachments: [metadata] }) })
    expect(() => checkPrivateFiles(store)).not.toThrow()
  })
  it.each([
    { bytes: false }, { manifest: false }, { size: 7 }, { sha256: '0'.repeat(64) }, { owner: 'test.foreign' },
  ])('rejects incomplete, corrupt or unowned inventories: %j', options => {
    addFile(options)
    expect(() => checkPrivateFiles(store)).toThrow(expect.objectContaining({ data: { reason: 'BACKUP_PLUGIN_FILE_MISMATCH' } }))
  })
  it('does not allow one plugin to reference another owner’s private file', () => {
    addFile(); store.put('pluginInstallations', { id: '2', pluginId: 'test.foreign' })
    row({ fileId: metadata.id }, 'test.foreign')
    expect(() => checkPrivateFiles(store)).toThrow(/reference/)
  })
  it.each(['name', 'size', 'sha256', 'createdAt'] as const)('rejects altered frozen file metadata: %s', field => {
    addFile(); row({ snapshot: JSON.stringify({ file: { ...metadata, [field]: 'changed' } }) })
    expect(() => checkPrivateFiles(store)).toThrow(/reference/)
  })
  it('rejects missing files referenced only through nested JSON', () => {
    row({ snapshot: JSON.stringify({ files: [metadata] }) })
    expect(() => checkPrivateFiles(store)).toThrow(/reference/)
  })
  it.each(['__plugin_files/INVALID', `__plugin_files/${pluginId}/not-a-uuid`, `${base}/extra`, `${base}/bytes/extra`])('rejects invalid private namespace paths: %s', path => {
    expect(() => privateFilePath(path)).toThrow()
  })
  it('leaves ordinary public uploads outside the private namespace', () => {
    expect(privateFilePath('other/proof.txt')).toBeNull()
    expect(privateFilePath(base)).toEqual({ kind: 'directory' })
  })
  it.each([
    Buffer.from('{broken'), Buffer.alloc(4097), Buffer.from(JSON.stringify({ ...metadata, id: randomUUID() })),
  ])('rejects invalid, oversized or mismatched metadata manifests %#', contents => {
    expect(() => indexPrivateManifest(store, `${base}/metadata.json`, contents)).toThrow()
  })
})
