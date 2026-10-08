/**
 * @file complete.ts
 * @project SlothVault
 * @module Complete Backup Operations
 * @description Coordinates durable backup jobs, administrator-bound previews, protected restores, and retention.
 * @logic Reserve one operation, validate immutable sources, create a protection snapshot, coordinate files with one database transaction, and retain committed results despite cleanup failures.
 * @dependencies private backup store, archive validation, restore journal, database unit-of-work, maintenance lock
 * @index_tags backup,restore,jobs,preflight,retention,transaction
 * @author holic512
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { lstat, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { unitOfWork } from '@/server/database/unit-of-work'
import { getDatabaseClient } from '@/server/database/client'
import { HttpError } from '@/server/http/errors'
import { UPLOAD_ROOT } from '@/server/services/admin-files'
import { withMaintenanceLock } from '@/server/services/maintenance-lock'
import type { BackupHistoryResponse, BackupJob, BackupPhase, BackupSnapshot, BackupSource, RestorePreview } from '@/types/backup'
import { inspectImportAccounts } from './accounts'
import { createCompleteSnapshot, readCompleteBundle, sha256File } from './archive'
import { COMPLETE_BACKUP_MAX_BYTES, DATABASE_BACKUP_VERSION, DATABASE_TRANSACTION_MAX_WAIT_MS, DATABASE_TRANSACTION_TIMEOUT_MS, RESTORE_COMMIT_CONFIG_KEY } from './constants'
import { importDatabaseRecords, invalidateBackupCaches } from './database-import'
import { ensureUploadRoot } from './files-common'
import { archiveSizeLimiter } from './files-export'
import { prepareRestoreJournal, readRestoreJournal, reconcileRestoreJournal, switchRestoreFiles, type RestoreJournal } from './recovery'
import { setBackupRecoveryError } from './recovery-state'
import { activeBackupJob, artifactPath, atomicJson, backupErrorCode, currentBackupJob, ensureBackupStorage, getBackupSnapshot, importPath, pinBackupSource, pinnedSnapshots, readJson, readRecords, readSettings, recordPath, releaseBackupJob, reserveBackupJob, reserveSnapshotDeletion, sourcePath, sourceSchema, updateBackupJob, workPath } from './store'

type ImportedArtifact = { id: string; actorUserId: number; sha256: string; size: number; expiresAt: string }
type PreviewRecord = RestorePreview & { actorUserId: number; sha256: string }
async function validateSource(source: BackupSource, actorUserId: number) {
  sourceSchema.parse(source)
  const path = sourcePath(source)
  let expected: string
  if (source.importId !== undefined) {
    const uploaded = await readJson<ImportedArtifact>(recordPath('imports', source.importId))
    if (!uploaded || uploaded.actorUserId !== actorUserId || new Date(uploaded.expiresAt).getTime() <= Date.now()) throw new HttpError('Backup upload has expired or is unavailable', 404, 404)
    const info = await lstat(path)
    if (!info.isFile() || info.size !== uploaded.size) throw new HttpError('Complete backup integrity verification failed', 409, 409)
    expected = uploaded.sha256
  } else expected = (await getBackupSnapshot(source.snapshotId)).sha256
  if (await sha256File(path) !== expected) throw new HttpError('Complete backup integrity verification failed', 409, 409)
  return { path, sha256: expected }
}
export async function uploadCompleteBackup(request: Request, actorUserId: number) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/zip') || !request.body) throw new HttpError('Expected application/zip', 400, 400)
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > COMPLETE_BACKUP_MAX_BYTES) throw new HttpError('Complete backup exceeds the size limit', 413, 413)
  await ensureBackupStorage()
  const id = randomUUID(), path = importPath(id), partial = `${path}.partial`
  try {
    await pipeline(Readable.fromWeb(request.body as import('node:stream/web').ReadableStream), archiveSizeLimiter(COMPLETE_BACKUP_MAX_BYTES), createWriteStream(partial, { flags: 'wx', mode: 0o600 }))
    const size = (await lstat(partial)).size
    if (size < 22) throw new HttpError('Invalid ZIP archive', 400, 400)
    const record: ImportedArtifact = { id, actorUserId, size, sha256: await sha256File(partial), expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }
    await rename(partial, path)
    await atomicJson(recordPath('imports', id), record)
    return { importId: id }
  } catch (error) {
    await rm(path, { force: true }).catch(() => undefined)
    throw error
  } finally { await rm(partial, { force: true }).catch(() => undefined) }
}

export async function previewCompleteRestore(source: BackupSource, actorUserId: number): Promise<RestorePreview> {
  sourceSchema.parse(source)
  await assertBackupIdle()
  const release = pinBackupSource(source)
  const id = randomUUID(), directory = workPath(id)
  try {
    const artifact = await validateSource(source, actorUserId)
    await ensureBackupStorage()
    const bundle = await readCompleteBundle(artifact.path, directory)
    const policy = await withMaintenanceLock('shared', () => unitOfWork.execute((tx) => inspectImportAccounts(tx, bundle.payload, { actorUserId, replaceUsers: true }), { mode: 'read' }))
    const warnings = bundle.payload.version === DATABASE_BACKUP_VERSION ? [] : ['LEGACY_BACKUP_SCOPE']
    if (bundle.payload.ignoredLegacyContracts || bundle.payload.data.merkleTrees.length || bundle.payload.data.compressedNfts.length) warnings.push('LEGACY_RECORDS_IGNORED')
    const preview: PreviewRecord = { id, source, manifest: bundle.manifest, warnings, preservedAdministrator: policy.admin.username, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), actorUserId, sha256: artifact.sha256 }
    await atomicJson(recordPath('previews', id), preview)
    const { actorUserId: _actor, sha256: _sha, ...dto } = preview
    void _actor; void _sha
    return dto
  } finally { release(); await rm(directory, { recursive: true, force: true }).catch(() => undefined) }
}
async function readPreview(id: string, actorUserId: number) {
  const preview = await readJson<PreviewRecord>(recordPath('previews', id))
  if (!preview || preview.id !== id || preview.actorUserId !== actorUserId || new Date(preview.expiresAt).getTime() <= Date.now()) throw new HttpError('Restore preview has expired', 409, 409)
  const artifact = await validateSource(preview.source, actorUserId)
  if (preview.sha256 !== artifact.sha256) throw new HttpError('Backup changed after preview', 409, 409)
  return { preview, artifact }
}
export async function queueCompleteBackup(actorUserId: number | null, kind: 'manual' | 'scheduled' = 'manual', retryOf?: string) {
  await assertBackupIdle()
  if (retryOf) {
    const previous = await getBackupJob(retryOf)
    if (!['manual', 'scheduled'].includes(previous.kind) || !['failed', 'interrupted'].includes(previous.status)) throw new HttpError('This task cannot be retried', 409, 409)
    kind = previous.kind as 'manual' | 'scheduled'
  }
  const job = await reserveBackupJob(kind, actorUserId)
  if (retryOf) {
    try { await updateBackupJob(job, { retryOf }) } catch (error) { await finishJob(job, error); throw error }
  }
  return job
}
export async function queueCompleteRestore(previewId: string, actorUserId: number) {
  await assertBackupIdle()
  const { preview } = await readPreview(previewId, actorUserId)
  const job = await reserveBackupJob('restore', actorUserId)
  try { await updateBackupJob(job, { source: preview.source, previewId }); return job }
  catch (error) { await finishJob(job, error); throw error }
}
async function finishJob(job: BackupJob, error?: unknown) {
  try {
    await updateBackupJob(job, { status: error ? 'failed' : 'succeeded', phase: error ? job.phase : 'complete', error: error ? backupErrorCode(error) : null, finishedAt: new Date().toISOString(), durationMs: Date.now() - new Date(job.startedAt ?? job.createdAt).getTime() })
  } catch {
    job.warnings.push('JOB_STATE_WRITE_FAILED')
    console.error('[backup] Task outcome could not be persisted')
  } finally { releaseBackupJob(job.id) }
}
export async function failQueuedBackup(job: BackupJob, error: unknown) { await finishJob(job, error) }

export async function runCompleteBackup(job: BackupJob) {
  let failure: unknown
  try {
    await updateBackupJob(job, { status: 'running', startedAt: new Date().toISOString() })
    const snapshot = await createCompleteSnapshot(job.kind as 'manual' | 'scheduled', job.id, (phase) => updateBackupJob(job, { phase }))
    job.warnings.push(...snapshot.warnings ?? [])
    try { await updateBackupJob(job, { snapshotId: snapshot.id }) } catch { job.warnings.push('JOB_STATE_WRITE_FAILED') }
    if (job.kind === 'scheduled') {
      try { await applyBackupRetention() } catch { job.warnings.push('RETENTION_CLEANUP_FAILED') }
    }
  } catch (error) { failure = error }
  await finishJob(job, failure)
}

export async function runCompleteRestore(job: BackupJob, previewId: string, sessionId: string) {
  let failure: unknown
  const input = resolve(UPLOAD_ROOT, `.complete-input-${job.id}`)
  const release = job.source ? pinBackupSource(job.source) : () => undefined
  try {
    await updateBackupJob(job, { status: 'running', phase: 'validating', startedAt: new Date().toISOString() })
    const { preview, artifact } = await readPreview(previewId, job.actorUserId!)
    await ensureUploadRoot()
    const bundle = await readCompleteBundle(artifact.path, input)
    job.warnings.push(...preview.warnings)
    await withMaintenanceLock('exclusive', async () => {
      const options = { actorUserId: job.actorUserId!, preserveSessionId: sessionId, replaceUsers: true }
      await unitOfWork.execute((tx) => inspectImportAccounts(tx, bundle.payload, options), { mode: 'read' })
      await updateBackupJob(job, { phase: 'protecting' })
      const protection = await createCompleteSnapshot('protect', randomUUID(), async () => { /* The surrounding restore owns the state lock. */ }, true)
      job.warnings.push(...protection.warnings ?? [])
      await updateBackupJob(job, { protectionId: protection.id, phase: 'restoring' })
      const journal = await prepareRestoreJournal(job.id, bundle.uploads)
      let committed = false
      try {
        await switchRestoreFiles(journal)
        await unitOfWork.execute(async (tx) => {
          await importDatabaseRecords(tx, bundle.payload, options)
          await tx.systemConfig.upsert({ where: { configKey: RESTORE_COMMIT_CONFIG_KEY }, create: { configKey: RESTORE_COMMIT_CONFIG_KEY, configValue: job.id, description: 'Coordinated restore commit receipt' }, update: { configValue: job.id } })
        }, { maxWait: DATABASE_TRANSACTION_MAX_WAIT_MS, timeout: DATABASE_TRANSACTION_TIMEOUT_MS })
        committed = true
      } catch (error) {
        try { committed = (await getDatabaseClient().systemConfig.findUnique({ where: { configKey: RESTORE_COMMIT_CONFIG_KEY } }))?.configValue === job.id }
        catch { setBackupRecoveryError('Backup recovery requires maintenance'); throw new HttpError('Backup recovery requires maintenance', 503, 503) }
        if (!committed) {
          try { await reconcileRestoreJournal(journal, false) }
          catch { setBackupRecoveryError('Backup recovery requires maintenance'); throw new HttpError('Backup recovery requires maintenance', 503, 503) }
          throw error
        }
        job.warnings.push('COMMIT_ACK_UNCERTAIN')
      }
      if (committed) {
        job.warnings.push(...await invalidateBackupCaches())
        try { await updateBackupJob(job, { phase: 'cleaning' }) } catch { job.warnings.push('JOB_STATE_WRITE_FAILED') }
        try { await reconcileRestoreJournal(journal, true) } catch { job.warnings.push('RESTORE_CLEANUP_FAILED') }
      }
    })
  } catch (error) { failure = error }
  finally { release(); try { await rm(input, { recursive: true, force: true }) } catch { job.warnings.push('WORK_CLEANUP_FAILED') } }
  await finishJob(job, failure)
}

export async function deleteBackupSnapshot(id: string, automatic = false) {
  if (!automatic && activeBackupJob()) throw new HttpError('A backup operation is already running', 409, 409, { reason: 'BACKUP_BUSY' })
  const release = reserveSnapshotDeletion(id)
  try {
    if ((await pinnedSnapshots()).has(id) || activeBackupJob()?.snapshotId === id) throw new HttpError('Backup is currently in use', 409, 409)
    const snapshot = await readJson<BackupSnapshot>(recordPath('snapshots', id))
    if (!snapshot || snapshot.id !== id) throw new HttpError('Backup not found', 404, 404)
    await rm(artifactPath(id), { force: true })
    await rm(recordPath('snapshots', id))
  } finally { release() }
}
export async function applyBackupRetention() {
  const settings = await readSettings(), pinned = await pinnedSnapshots()
  const snapshots = (await readRecords<BackupSnapshot>('snapshots')).filter((snapshot) => snapshot.kind === 'scheduled').sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  for (const snapshot of snapshots.slice(settings.retentionCount)) if (!pinned.has(snapshot.id)) await deleteBackupSnapshot(snapshot.id, true)
}
export async function backupHistory(): Promise<BackupHistoryResponse> {
  const snapshots = (await readRecords<BackupSnapshot>('snapshots')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((snapshot) => {
    const { files, ...manifest } = snapshot.manifest
    return { ...snapshot, manifest: { ...manifest, fileCount: files.length } }
  })
  const jobs = (await readRecords<BackupJob>('jobs')).map((job) => currentBackupJob(job.id) ?? job).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100)
  return { snapshots, jobs, activeJob: activeBackupJob() }
}
export async function getBackupJob(id: string) {
  const job = currentBackupJob(id) ?? await readJson<BackupJob>(recordPath('jobs', id))
  if (!job || job.id !== id) throw new HttpError('Backup job not found', 404, 404)
  return job
}
export async function assertNoPendingRestore() {
  if (await readRestoreJournal()) throw new HttpError('Backup recovery requires maintenance', 409, 409)
}
export async function assertBackupIdle() {
  if (activeBackupJob()) throw new HttpError('A backup operation is already running', 409, 409, { reason: 'BACKUP_BUSY' })
  await assertNoPendingRestore()
}
export type { RestoreJournal, BackupPhase }
