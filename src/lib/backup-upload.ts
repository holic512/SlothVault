/**
 * @file backup-upload.ts
 * @project SlothVault
 * @module Backup Upload Client
 * @description Uploads bounded backup slices and remembers resumable sessions across page reloads.
 * @logic Match reselected files, reconcile acknowledged offsets after failures, retry three times, and preserve progress when paused.
 * @dependencies browser File, Web Crypto, localStorage, backup upload API
 * @index_tags backup,upload,resume,checksum,client
 * @author holic512
 */
import { ApiClientError, apiFetch } from '@/lib/api-client'
import type { BackupUpload } from '@/types/backup'

const prefix = '/api/admin/mm/backup/imports'
const storageKey = 'slothvault.backup-upload.v2'
export function rememberedBackupUpload(): BackupUpload | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as BackupUpload | null
    return value && typeof value.importId === 'string' && Number.isSafeInteger(value.size) ? value : null
  } catch { return null }
}
export function rememberBackupUpload(value: BackupUpload | null) {
  try { if (value) localStorage.setItem(storageKey, JSON.stringify(value)); else localStorage.removeItem(storageKey) } catch { /* Uploads still work when storage is unavailable. */ }
}
export async function backupChunkHash(blob: Blob) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
export async function backupFileFingerprint(file: File) {
  const edge = 64 * 1024
  return backupChunkHash(new Blob([String(file.size), ':', String(file.lastModified), ':', file.slice(0, edge), file.slice(Math.max(0, file.size - edge))]))
}
export async function uploadBackupFile(file: File, saved: BackupUpload | null, signal: AbortSignal, onProgress: (upload: BackupUpload) => void) {
  const fingerprint = await backupFileFingerprint(file)
  signal.throwIfAborted()
  if (saved && (saved.size !== file.size || saved.lastModified !== file.lastModified || saved.fingerprint !== fingerprint)) {
    throw new Error('BACKUP_UPLOAD_FILE_MISMATCH')
  }
  let upload = saved
    ? await apiFetch<BackupUpload>(`${prefix}/${saved.importId}`, { signal })
    : await apiFetch<BackupUpload>(prefix, { method: 'POST', signal, body: JSON.stringify({ size: file.size, fileName: file.name, lastModified: file.lastModified, fingerprint }) })
  const report = () => { rememberBackupUpload(upload); onProgress(upload) }
  report()
  while (upload.offset < upload.size) {
    signal.throwIfAborted()
    const offset = upload.offset, chunk = file.slice(offset, offset + upload.chunkSize)
    const hash = await backupChunkHash(chunk)
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted()
      try {
        upload = await apiFetch<BackupUpload>(`${prefix}/${upload.importId}`, { method: 'PATCH', body: chunk, signal, headers: { 'Content-Type': 'application/octet-stream', 'Upload-Offset': String(offset), 'X-Chunk-SHA256': hash } })
        report(); break
      } catch (error) {
        if (signal.aborted) throw error
        // A lost response may have acknowledged the slice. Read the durable offset before resending.
        try {
          upload = await apiFetch<BackupUpload>(`${prefix}/${upload.importId}`, { signal })
          report()
          if (upload.offset !== offset) break
        } catch (statusError) {
          if (statusError instanceof ApiClientError && statusError.status === 404) throw statusError
        }
        if (attempt >= 3 || (error instanceof ApiClientError && error.status >= 400 && error.status < 500 && error.status !== 409)) throw error
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(signal.reason) }
          const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 500 * 2 ** attempt)
          signal.addEventListener('abort', abort, { once: true })
        })
      }
    }
  }
  const source = await apiFetch<{ importId: string }>(`${prefix}/${upload.importId}/complete`, { method: 'POST', signal })
  upload = { ...upload, state: 'uploaded' }; report()
  return source
}
