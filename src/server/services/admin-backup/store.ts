/**
 * @file store.ts
 * @project SlothVault
 * @module Private Backup Storage
 * @description Persists backup artifacts and durable control records outside the restored business database.
 * @logic Isolate storage roots, validate server-generated identifiers, fsync atomic records, and reserve one process-wide operation.
 * @dependencies Node filesystem, app-data paths, upload storage, Zod, backup API types
 * @index_tags backup,storage,permissions,jobs,atomic,persistence
 * @author holic512
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, statfs } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { appConfigPath, appDataPath, appDatabasePath } from '@/server/config/app-data'
import { UPLOAD_ROOT } from '@/server/services/admin-files'
import { HttpError } from '@/server/http/errors'
import type { BackupJob, BackupSettings, BackupSnapshot, BackupSource, RestorePreview } from '@/types/backup'
import { BACKUP_MANIFEST_MAX_BYTES } from './constants'

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { enabled: false, dailyTime: '03:00', timeZone: 'Asia/Shanghai', retentionCount: 7 }
export const settingsSchema = z.object({
  enabled: z.boolean(),
  dailyTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  timeZone: z.string().min(1).max(80).refine((value) => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }),
  retentionCount: z.number().int().min(1).max(365),
}).strict()
export const sourceSchema = z.union([
  z.object({ snapshotId: z.string().uuid() }).strict(),
  z.object({ importId: z.string().uuid() }).strict(),
])

type RuntimeState = { active: BackupJob | null; pins: Map<string, number>; deleting: Set<string>; finished: Map<string, BackupJob> }
const globalState = globalThis as unknown as { slothVaultBackupOperations?: RuntimeState }
const state = globalState.slothVaultBackupOperations ??= { active: null, pins: new Map(), deleting: new Set(), finished: new Map() }

export function requireBackupId(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new HttpError('Invalid backup ID', 400, 400)
  return id
}
export function backupStoragePath() {
  return resolve(/* turbopackIgnore: true */ process.env.BACKUP_STORAGE_PATH?.trim() || resolve(appDataPath(), 'backups'))
}
export function backupStatePath() { return resolve(appConfigPath(), 'backup-state') }
export function recordPath(group: 'jobs' | 'snapshots' | 'previews' | 'imports', id: string) {
  return resolve(backupStatePath(), group, `${requireBackupId(id)}.json`)
}
export function artifactPath(id: string) { return resolve(backupStoragePath(), `${requireBackupId(id)}.zip`) }
export function importPath(id: string) { return resolve(backupStoragePath(), 'imports', `${requireBackupId(id)}.zip`) }
export function sourcePath(source: BackupSource) { return source.importId !== undefined ? importPath(source.importId) : artifactPath(source.snapshotId) }
export function workPath(id: string) { return resolve(backupStoragePath(), 'work', requireBackupId(id)) }

function overlaps(left: string, right: string) {
  const within = (root: string, target: string) => {
    const rel = relative(root, target)
    return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
  }
  return within(left, right) || within(right, left)
}
async function canonical(path: string): Promise<string> {
  try { return await realpath(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = dirname(path)
    if (parent === path) throw error
    return resolve(await canonical(parent), relative(parent, path))
  }
}

export async function ensureBackupStorage() {
  const root = backupStoragePath()
  const protectedRoots = [UPLOAD_ROOT, appConfigPath(), appDatabasePath()]
  if (protectedRoots.some((path) => overlaps(root, path))) throw new HttpError('Backup storage overlaps application storage', 503, 503)
  const realRoot = await canonical(root)
  for (const path of protectedRoots) {
    if (overlaps(realRoot, await canonical(path))) throw new HttpError('Backup storage overlaps application storage', 503, 503)
  }
  for (const path of [root, resolve(root, 'imports'), resolve(root, 'work'), backupStatePath(), ...['jobs', 'snapshots', 'previews', 'imports'].map((name) => resolve(backupStatePath(), name))]) {
    await mkdir(path, { recursive: true, mode: 0o700 })
    if ((await lstat(path)).isSymbolicLink()) throw new HttpError('Unsafe backup storage directory', 503, 503)
    await chmod(path, 0o700)
  }
}

export async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
  try {
    await rename(temporary, path)
    const directory = await open(resolve(path, '..'), 'r')
    try { await directory.sync() } finally { await directory.close() }
  } finally { await rm(temporary, { force: true }) }
}
export async function readJson<T>(path: string): Promise<T | null> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.size > BACKUP_MANIFEST_MAX_BYTES) throw new HttpError('Invalid backup control record', 503, 503)
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}
export async function readSettings(): Promise<BackupSettings> {
  const value = await readJson( resolve(backupStatePath(), 'settings.json'))
  return value === null ? { ...DEFAULT_BACKUP_SETTINGS } : settingsSchema.parse(value)
}
export async function readRecords<T>(group: 'jobs' | 'snapshots' | 'previews' | 'imports') {
  let names: string[]
  try { names = await readdir(resolve(backupStatePath(), group)) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [] as T[]; throw error }
  const rows: T[] = []
  for (const name of names) {
    if (!name.endsWith('.json') || !z.string().uuid().safeParse(name.slice(0, -5)).success) continue
    const row = await readJson<T>(recordPath(group, name.slice(0, -5)))
    if (row) rows.push(row)
  }
  return rows
}
export function activeBackupJob() { return state.active }
export async function reserveBackupJob(kind: BackupJob['kind'], actorUserId: number | null) {
  if (state.active) throw new HttpError('A backup operation is already running', 409, 409, { reason: 'BACKUP_BUSY' })
  const job: BackupJob = { id: randomUUID(), kind, status: 'queued', phase: 'queued', createdAt: new Date().toISOString(), finishedAt: null, actorUserId, error: null, warnings: [] }
  state.active = job
  try { await ensureBackupStorage(); await atomicJson(recordPath('jobs', job.id), job); return job } catch (error) { state.active = null; throw error }
}
export async function updateBackupJob(job: BackupJob, patch: Partial<BackupJob>) {
  Object.assign(job, patch)
  await atomicJson(recordPath('jobs', job.id), job)
}
export function releaseBackupJob(id: string) {
  if (state.active?.id === id) {
    state.finished.set(id, state.active)
    if (state.finished.size > 100) state.finished.delete(state.finished.keys().next().value!)
    state.active = null
  }
}
export function currentBackupJob(id: string) { return state.active?.id === id ? state.active : state.finished.get(id) }
export function pinSnapshot(id: string) {
  requireBackupId(id)
  if (state.deleting.has(id)) throw new HttpError('Backup is being deleted', 409, 409)
  state.pins.set(id, (state.pins.get(id) ?? 0) + 1)
  let released = false
  return () => { if (!released) { released = true; const count = (state.pins.get(id) ?? 1) - 1; if (count > 0) state.pins.set(id, count); else state.pins.delete(id) } }
}
export function pinBackupSource(source: BackupSource) { return pinSnapshot(source.importId ?? source.snapshotId) }
export function sourceIsPinned(id: string) { return state.pins.has(id) || state.active?.source?.importId === id || state.active?.source?.snapshotId === id }
export function reserveSnapshotDeletion(id: string) {
  requireBackupId(id)
  if (sourceIsPinned(id) || state.deleting.has(id)) throw new HttpError('Backup is currently in use', 409, 409)
  state.deleting.add(id)
  return () => state.deleting.delete(id)
}
export async function pinnedImports() {
  const pinned = new Set(state.pins.keys())
  if (state.active?.source?.importId) pinned.add(state.active.source.importId)
  for (const preview of await readRecords<RestorePreview>('previews')) {
    if (preview.source.importId && new Date(preview.expiresAt).getTime() > Date.now()) pinned.add(preview.source.importId)
  }
  return pinned
}
export async function pinnedSnapshots() {
  const pinned = new Set(state.pins.keys())
  if (state.active?.source?.snapshotId) pinned.add(state.active.source.snapshotId)
  for (const preview of await readRecords<RestorePreview>('previews')) {
    if (preview.source.snapshotId && new Date(preview.expiresAt).getTime() > Date.now()) pinned.add(preview.source.snapshotId)
  }
  return pinned
}
export async function getBackupSnapshot(id: string) {
  const snapshot = await readJson<BackupSnapshot>(recordPath('snapshots', id))
  if (!snapshot || snapshot.id !== id) throw new HttpError('Backup not found', 404, 404)
  const info = await lstat(artifactPath(id)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new HttpError('Backup artifact is unavailable', 409, 409)
    throw error
  })
  if (!info.isFile() || info.size !== snapshot.size) throw new HttpError('Backup artifact is unavailable', 409, 409)
  return snapshot
}
export async function storageStatus() {
  try { await ensureBackupStorage(); const info = await statfs(backupStoragePath(), { bigint: true }); return { path: backupStoragePath(), availableBytes: (info.bavail * info.bsize).toString(), error: null } }
  catch { return { path: backupStoragePath(), availableBytes: null, error: 'STORAGE_UNAVAILABLE' } }
}
export function backupErrorCode(error: unknown) {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ENOSPC' || code === 'EDQUOT') return 'STORAGE_FULL'
  if (code === 'EACCES' || code === 'EROFS') return 'STORAGE_UNAVAILABLE'
  if (code === 'P2002') return 'BACKUP_UNIQUE_CONFLICT'
  if (error instanceof HttpError) {
    const reason = (error.data as { reason?: string } | null)?.reason
    if (reason && /^[A-Z_]{1,80}$/.test(reason)) return reason
    if (error.status === 413) return 'BACKUP_TOO_LARGE'
    if (error.status === 400 || error.status === 409) return 'BACKUP_INVALID'
  }
  return 'BACKUP_FAILED'
}
