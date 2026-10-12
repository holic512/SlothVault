import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError, apiFetch } from './api-client'
import { backupChunkHash, backupFileFingerprint, rememberBackupUpload, rememberedBackupUpload, uploadBackupFile } from './backup-upload'
import type { BackupUpload } from '@/types/backup'
vi.mock('./api-client', async load => ({ ...await load<typeof import('./api-client')>(), apiFetch: vi.fn() }))
const request = vi.mocked(apiFetch)
const chunkSize = 8 * 1024 ** 2
let session: BackupUpload
const file = () => new File([new Uint8Array(chunkSize + 32)], 'backup.zip', { lastModified: 100 })
beforeEach(() => {
  vi.clearAllMocks()
  const saved = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) })
  session = { importId: '5607e495-c095-400b-b6ec-d7610c00a2fb', size: chunkSize + 32, offset: 0, chunkSize, fingerprint: '', fileName: 'backup.zip', lastModified: 100, expiresAt: '2026-10-13T00:00:00Z', state: 'uploading' }
  request.mockImplementation(async (_input, init) => {
    if (init?.method === 'POST' && init.body) { session = { ...session, ...JSON.parse(String(init.body)) }; return { ...session } }
    if (init?.method === 'PATCH') {
      const headers = init.headers as Record<string, string>, chunk = init.body as Blob
      expect(Number(headers['Upload-Offset'])).toBe(session.offset)
      expect(chunk.size).toBeLessThanOrEqual(chunkSize)
      expect(await backupChunkHash(chunk)).toBe(headers['X-Chunk-SHA256'])
      session.offset += chunk.size; return { ...session }
    }
    if (init?.method === 'POST') { session.state = 'uploaded'; return { importId: session.importId } }
    return { ...session }
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('browser backup upload client', () => {
  it('uploads bounded slices and persists completed progress', async () => {
    const updates: number[] = []
    const source = await uploadBackupFile(file(), null, new AbortController().signal, upload => updates.push(upload.offset))
    expect(source.importId).toBe(session.importId)
    expect(updates).toEqual([0, chunkSize, chunkSize + 32, chunkSize + 32])
    expect(rememberedBackupUpload()?.state).toBe('uploaded')
  })
  it('reselects the original file after reload and reconciles a lost chunk response', async () => {
    const selected = file(); session.fingerprint = await backupFileFingerprint(selected); session.offset = chunkSize
    rememberBackupUpload(session)
    const implementation = request.getMockImplementation()!
    let lost = true
    request.mockImplementation(async (input, init) => {
      const result = await implementation(input, init)
      if (init?.method === 'PATCH' && lost) { lost = false; throw new TypeError('network response lost') }
      return result
    })
    await uploadBackupFile(selected, rememberedBackupUpload(), new AbortController().signal, () => undefined)
    expect(request.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
    expect(session.offset).toBe(session.size)
  })
  it('rejects a different reselected file without sending requests', async () => {
    session.fingerprint = await backupFileFingerprint(file())
    await expect(uploadBackupFile(new File(['different'], 'backup.zip', { lastModified: 100 }), session, new AbortController().signal, () => undefined)).rejects.toThrow('BACKUP_UPLOAD_FILE_MISMATCH')
    expect(request).not.toHaveBeenCalled()
  })
  it('stops on abort and keeps the confirmed slice for the next attempt', async () => {
    const controller = new AbortController()
    await expect(uploadBackupFile(file(), null, controller.signal, upload => { if (upload.offset === chunkSize) controller.abort() })).rejects.toBeDefined()
    expect(rememberedBackupUpload()?.offset).toBe(chunkSize)
    expect(request.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
  })
  it('retries three times then preserves the paused session', async () => {
    const implementation = request.getMockImplementation()!
    request.mockImplementation(async (input, init) => {
      if (init?.method === 'PATCH') throw new TypeError('offline')
      return implementation(input, init)
    })
    await expect(uploadBackupFile(file(), null, new AbortController().signal, () => undefined)).rejects.toThrow('offline')
    expect(request.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(4)
    expect(rememberedBackupUpload()?.offset).toBe(0)
  }, 10000)
  it('reports expired server sessions and preserves the error status', async () => {
    session.fingerprint = await backupFileFingerprint(file())
    request.mockRejectedValue(new ApiClientError('expired', 404, 404, { reason: 'BACKUP_UPLOAD_EXPIRED' }))
    await expect(uploadBackupFile(file(), session, new AbortController().signal, () => undefined)).rejects.toMatchObject({ status: 404 })
  })
})
