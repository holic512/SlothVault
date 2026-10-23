import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import unzipper from 'unzipper'
import { beforeEach, describe, expect, it } from 'vitest'
import { deletePluginUpload, ensurePluginFiles, inspectPluginFile, listPluginFiles, PLUGIN_FILE_MAX_BYTES, pluginArchive, pluginFilesRoot, savePluginUpload, streamPluginFile } from './files'
const owner = 'test.files', other = 'test.other'
function upload(chunks: Uint8Array[], size = chunks.reduce((n, chunk) => n + chunk.byteLength, 0), name = '证据.txt') {
  return { name, size, stream: () => new ReadableStream<Uint8Array>({ pull(controller) { const chunk = chunks.shift(); if (chunk) controller.enqueue(chunk); else controller.close() } }) }
}
beforeEach(async () => { await rm(pluginFilesRoot(), { recursive: true, force: true }) })
describe('private plugin streaming files', () => {
  it('accepts only name/size/stream, publishes matching private metadata and streams bytes', async () => {
    const input = upload([Buffer.from('hello '), Buffer.from('world')])
    const metadata = await savePluginUpload(owner, input)
    expect(metadata).toMatchObject({ name: '证据.txt', size: '11', sha256: createHash('sha256').update('hello world').digest('hex') })
    expect(await inspectPluginFile(owner, metadata.id)).toEqual(metadata)
    expect(await ensurePluginFiles(owner, [metadata.id])).toEqual([metadata])
    const response = await streamPluginFile(owner, metadata.id)
    expect(await response.text()).toBe('hello world')
    expect(response.headers.get('Content-Disposition')).toContain('UTF-8')
    expect(await readdir(resolve(pluginFilesRoot(), owner, metadata.id))).toEqual(['bytes', 'metadata.json'])
    expect(JSON.parse(await readFile(resolve(pluginFilesRoot(), owner, metadata.id, 'metadata.json'), 'utf8'))).toEqual(metadata)
    expect(metadata).not.toHaveProperty('path')
  })
  it('supports empty files and rejects spoofed lengths, traversal, oversized declarations and failed input streams', async () => {
    const empty = await savePluginUpload(owner, upload([]))
    expect(await (await streamPluginFile(owner, empty.id)).text()).toBe('')
    await deletePluginUpload(owner, empty.id)
    await expect(savePluginUpload(owner, upload([Buffer.from('long')], 1))).rejects.toThrow(/size/)
    await expect(savePluginUpload(owner, upload([Buffer.from('short')], 10))).rejects.toThrow(/size/)
    await expect(savePluginUpload(owner, upload([], PLUGIN_FILE_MAX_BYTES + 1))).rejects.toThrow(/100 MiB/)
    await expect(savePluginUpload('../escape', upload([]))).rejects.toThrow()
    await expect(savePluginUpload(owner, upload([], 0, '../escape'))).rejects.toThrow()
    await expect(savePluginUpload(owner, { name: 'broken', size: 1, stream: () => new ReadableStream({ start(c) { c.error(new Error('disconnected')) } }) })).rejects.toThrow('disconnected')
    expect(await readdir(resolve(pluginFilesRoot(), owner))).toEqual([])
  })
  it('streams the full 100 MiB boundary without an aggregate input buffer', async () => {
    let remaining = PLUGIN_FILE_MAX_BYTES
    const file = await savePluginUpload(owner, { name: 'large.bin', size: remaining, stream: () => new ReadableStream({ pull(c) { if (!remaining) { c.close(); return }; const length = Math.min(65536, remaining); remaining -= length; c.enqueue(new Uint8Array(length)) } }) })
    expect(file.size).toBe(String(PLUGIN_FILE_MAX_BYTES))
    expect((await inspectPluginFile(owner, file.id)).sha256).toBe(file.sha256)
  }, 30_000)
  it('rejects cross-plugin access, symlinks and same-size SHA256 tampering', async () => {
    const file = await savePluginUpload(owner, upload([Buffer.from('one')]))
    await expect(inspectPluginFile(other, file.id)).rejects.toThrow('not found')
    await deletePluginUpload(other, file.id)
    expect((await inspectPluginFile(owner, file.id)).id).toBe(file.id)
    await writeFile(resolve(pluginFilesRoot(), owner, file.id, 'bytes'), 'two')
    await expect(inspectPluginFile(owner, file.id)).rejects.toThrow('integrity')
    const id = randomUUID()
    await symlink(resolve(pluginFilesRoot(), owner, file.id), resolve(pluginFilesRoot(), owner, id))
    await expect(inspectPluginFile(owner, id)).rejects.toThrow('Unsafe')
    await expect(deletePluginUpload(owner, id)).rejects.toThrow('Unsafe')
  })
  it('streams ZIPs and rejects missing files, ambiguous entries, path traversal and collisions', async () => {
    const file = await savePluginUpload(owner, upload([Buffer.from('payload')]))
    const response = await pluginArchive(owner, { name: 'evidence.zip', entries: [{ path: 'notes/readme.txt', text: '说明' }, { path: 'files/evidence.txt', fileId: file.id }] })
    const zip = await unzipper.Open.buffer(Buffer.from(await response.arrayBuffer()))
    expect(zip.files.map(f => f.path)).toEqual(['notes/readme.txt', 'files/evidence.txt'])
    expect((await zip.files[1].buffer()).toString()).toBe('payload')
    for (const path of ['../x', '/x', 'a\\b', 'C:/x', 'a//b']) await expect(pluginArchive(owner, { name: 'x.zip', entries: [{ path, text: '' }] })).rejects.toThrow()
    await expect(pluginArchive(owner, { name: 'x.zip', entries: [{ path: 'a', text: '', fileId: file.id }] })).rejects.toThrow()
    await expect(pluginArchive(owner, { name: 'x.zip', entries: [{ path: 'a', text: '' }, { path: 'A/b', text: '' }] })).rejects.toThrow()
    await expect(pluginArchive(other, { name: 'x.zip', entries: [{ path: 'a', fileId: file.id }] })).rejects.toThrow()
  })
  it('compensates failed completion and omits unfinished uploads from backup enumeration', async () => {
    const file = await savePluginUpload(owner, upload([Buffer.from('x')]))
    await mkdir(resolve(pluginFilesRoot(), owner, `.upload-${randomUUID()}`))
    const entries = []; for await (const entry of listPluginFiles()) entries.push(entry)
    expect(entries).toHaveLength(1)
    await deletePluginUpload(owner, file.id)
    await deletePluginUpload(owner, file.id)
    await expect(inspectPluginFile(owner, file.id)).rejects.toThrow('not found')
  })
})
