/**
 * @file complete.ts
 * @project SlothVault
 * @module Complete Backup Operations
 * @description Coordinates generated and imported snapshots, administrator-bound previews, protected restores, and retention.
 * @logic Serialize operations, validate and publish imported archives without restoring, recheck compatible restore sources, rotate isolated telemetry epochs after committed restores, and retain committed results despite cleanup failures. Reconcile plugin staging and registry state before releasing the restore maintenance lock.
 * @dependencies private backup store, archive validation, restore journal, database unit-of-work, maintenance lock, plugin staging restore
 * @index_tags backup,restore,jobs,preflight,retention,transaction
 * @author holic512
 */
import 'server-only'
import { reloadPluginRegistry } from '@/server/plugins/manager'
import { preparePluginRestore, reconcilePluginRestore } from '@/server/plugins/backup'
import { rotateTelemetryEpoch } from '@/server/telemetry/runtime'
import { randomUUID } from 'node:crypto'
import { lstat, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { unitOfWork } from '@/server/database/unit-of-work'
import { getDatabaseClient } from '@/server/database/client'
import { HttpError } from '@/server/http/errors'
import { UPLOAD_ROOT } from '@/server/services/admin-files'
import { withMaintenanceLock } from '@/server/services/maintenance-lock'
import type { BackupHistoryResponse, BackupJob, BackupPhase, BackupSnapshot, BackupSource, RestorePreview, BackupProgress } from '@/types/backup'
import { inspectImportAccounts } from './accounts'
import { createCompleteSnapshot, readCompleteBundle, sha256File } from './archive'
import { backupCompatibility, requireBackupCompatibility } from './compatibility'
import { BACKUP_UPLOAD_TTL_MS, DATABASE_TRANSACTION_MAX_WAIT_MS, DATABASE_TRANSACTION_TIMEOUT_MS, RESTORE_COMMIT_CONFIG_KEY } from './constants'
import { importDatabaseRecords, invalidateBackupCaches } from './database-import'
import { ensureUploadRoot } from './files-common'
import { markImportedSnapshotDeleted, publishBackupUpload, readBackupUploadRecord, withBackupUpload, type BackupUploadRecord } from './uploads'
import { prepareRestoreJournal, readRestoreJournal, reconcileRestoreJournal, switchRestoreFiles, type RestoreJournal } from './recovery'
import { setBackupRecoveryError } from './recovery-state'
import { activeBackupJob, artifactPath, atomicJson, backupErrorCode, currentBackupJob, ensureBackupStorage, getBackupSnapshot, pinBackupSource, pinnedSnapshots, readJson, readRecords, readSettings, recordPath, releaseBackupJob, reserveBackupJob, reserveSnapshotDeletion, sourcePath, sourceSchema, updateBackupJob, workPath } from './store'

type PreviewRecord = RestorePreview & { actorUserId: number; sha256: string }
async function validateSource(source: BackupSource, actorUserId: number, verifyHash = true) {
  sourceSchema.parse(source)
  let path = sourcePath(source)
  let expected: string, hashVerified = false
  if (source.importId !== undefined) {
    const uploaded = await readJson<BackupUploadRecord>(recordPath('imports', source.importId))
    const active = activeBackupJob()
    const inUse = uploaded && ((active?.source?.importId === source.importId && new Date(active.createdAt).getTime() < new Date(uploaded.expiresAt).getTime()) || (await readRecords<PreviewRecord>('previews')).some(preview => preview.source.importId === source.importId && new Date(preview.expiresAt).getTime() > Date.now()))
    if (!uploaded || uploaded.state !== 'uploaded' || uploaded.actorUserId !== actorUserId || (new Date(uploaded.expiresAt).getTime() <= Date.now() && !inUse)) throw new HttpError('Backup upload has expired or is unavailable', 404, 404)
    if (uploaded.snapshotId) {
      const snapshot = await getBackupSnapshot(uploaded.snapshotId)
      requireBackupCompatibility(snapshot.manifest)
      path = artifactPath(snapshot.id)
      expected = snapshot.sha256
    } else {
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.size !== uploaded.size) throw new HttpError('Complete backup integrity verification failed', 409, 409)
      if (!uploaded.sha256) { if (!verifyHash) throw new HttpError('Backup source has not been validated',409,409); uploaded.sha256 = await sha256File(path); hashVerified = true; await atomicJson(recordPath('imports', source.importId), uploaded) }
      expected = uploaded.sha256
    }
  } else {
    const snapshot = await getBackupSnapshot(source.snapshotId)
    requireBackupCompatibility(snapshot.manifest)
    expected = snapshot.sha256
  }
  if (verifyHash && !hashVerified && await sha256File(path) !== expected) throw new HttpError('Complete backup integrity verification failed', 409, 409)
  return { path, sha256: expected }
}

export async function previewCompleteRestore(source: BackupSource, actorUserId: number, progress?: (value: Partial<BackupProgress>) => Promise<void>, job?: BackupJob): Promise<RestorePreview> {
  sourceSchema.parse(source)
  if (!job || activeBackupJob()?.id !== job.id) await assertBackupIdle()
  const release = pinBackupSource(source)
  const id = randomUUID(), directory = workPath(id)
  let bundle: Awaited<ReturnType<typeof readCompleteBundle>> | undefined
  try {
    const artifact = await validateSource(source, actorUserId)
    await ensureBackupStorage()
    bundle = await readCompleteBundle(artifact.path, directory, false, progress)
    const policy = await withMaintenanceLock('shared', () => unitOfWork.execute((tx) => inspectImportAccounts(tx, bundle!.payload, { actorUserId, replaceUsers: true }), { mode: 'read', maxWait: DATABASE_TRANSACTION_MAX_WAIT_MS, timeout: DATABASE_TRANSACTION_TIMEOUT_MS }))
    const warnings: string[] = bundle.manifest.databaseVersion === '2.18.0' ? [] : ['LEGACY_GIFT_CARDS_RETIRED']
    const preview: PreviewRecord = { id, source, manifest: bundle.manifest, warnings, preservedAdministrator: policy.admin.username, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), actorUserId, sha256: artifact.sha256 }
    await atomicJson(recordPath('previews', id), preview)
    const { actorUserId: _actor, sha256: _sha, ...dto } = preview
    void _actor; void _sha
    return dto
  } finally { bundle?.store.close(); release(); await rm(directory, { recursive: true, force: true }).catch(() => undefined) }
}
async function readPreview(id: string, actorUserId: number, verifyHash = true) {
  const preview = await readJson<PreviewRecord>(recordPath('previews', id))
  if (!preview || preview.id !== id || preview.actorUserId !== actorUserId || new Date(preview.expiresAt).getTime() <= Date.now()) throw new HttpError('Restore preview has expired', 409, 409)
  const artifact = await validateSource(preview.source, actorUserId, verifyHash)
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
  const { preview } = await readPreview(previewId, actorUserId, false)
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

export async function queueCompleteImport(importId: string, actorUserId: number) {
  const existing = await readBackupUploadRecord(importId, actorUserId)
  if (existing.importJobId) {
    const previous = await getBackupJob(existing.importJobId)
    if (['queued', 'running', 'succeeded'].includes(previous.status)) return { job: previous, queued: false }
  }
  return withBackupUpload(importId, actorUserId, async (upload) => {
    if (upload.importJobId) {
      const previous = await getBackupJob(upload.importJobId)
      if (['queued', 'running', 'succeeded'].includes(previous.status)) return { job: previous, queued: false }
    }
    if (upload.state !== 'uploaded' || upload.offset !== upload.size) throw new HttpError('Backup upload is incomplete', 409, 409, { reason: 'BACKUP_UPLOAD_INCOMPLETE' })
    await assertBackupIdle()
    const job = await reserveBackupJob('import', actorUserId)
    try {
      await updateBackupJob(job, { source: { importId }, snapshotId: upload.id })
      upload.importJobId = job.id
      upload.expiresAt = new Date(Date.now() + BACKUP_UPLOAD_TTL_MS).toISOString()
      await atomicJson(recordPath('imports', upload.id), upload)
      return { job, queued: true }
    } catch (error) { await finishJob(job, error); throw error }
  })
}

export async function runCompleteImport(job: BackupJob) {
  let failure: unknown
  let bundle: Awaited<ReturnType<typeof readCompleteBundle>> | undefined
  const directory = workPath(job.id)
  const release = pinBackupSource(job.source!)
  try {
    await updateBackupJob(job, { status: 'running', phase: 'validating', startedAt: new Date().toISOString() })
    const snapshot = await withBackupUpload(job.source!.importId!, job.actorUserId!, async (upload) => {
      if (upload.snapshotId) return getBackupSnapshot(upload.snapshotId)
      if (!upload.publication) {
        const artifact = await validateSource(job.source!, job.actorUserId!)
        bundle = await readCompleteBundle(artifact.path, directory, false, progressFor(job))
        upload.sha256 = artifact.sha256
        upload.publication = { id: upload.id, kind: 'imported', createdAt: bundle.manifest.createdAt, importedAt: new Date().toISOString(), fileName: upload.fileName, size: upload.size, sha256: artifact.sha256, manifest: bundle.manifest }
        await atomicJson(recordPath('imports', upload.id), upload)
      }
      return publishBackupUpload(upload)
    })
    job.warnings.push(...snapshot.warnings ?? [])
    try { await updateBackupJob(job, { snapshotId: snapshot.id }) } catch { job.warnings.push('JOB_STATE_WRITE_FAILED') }
  } catch (error) { failure = error }
  finally {
    bundle?.store.close()
    release()
    try { await rm(directory, { recursive: true, force: true }) } catch { job.warnings.push('WORK_CLEANUP_FAILED') }
  }
  await finishJob(job, failure)
}

function progressFor(job: BackupJob) {
  let lastWrite = 0
  return async (patch: Partial<BackupProgress>) => {
    job.progress = { processedFiles:0,processedRecords:0,processedBytes:0,...job.progress,...patch }
    if (Date.now()-lastWrite < 500) return
    lastWrite=Date.now(); await updateBackupJob(job,{progress:job.progress})
  }
}
export async function queueCompletePreview(source: BackupSource, actorUserId: number) {
  sourceSchema.parse(source); await assertBackupIdle()
  const job = await reserveBackupJob('preview',actorUserId)
  try { await updateBackupJob(job,{source}); return job } catch(error) { await finishJob(job,error); throw error }
}
export async function runCompletePreview(job: BackupJob) {
  let failure: unknown
  try {
    await updateBackupJob(job,{status:'running',phase:'validating',startedAt:new Date().toISOString()})
    const preview = await previewCompleteRestore(job.source!,job.actorUserId!,progressFor(job),job)
    await updateBackupJob(job,{preview,previewId:preview.id})
  } catch(error) { failure=error }
  await finishJob(job,failure)
}

export async function runCompleteBackup(job: BackupJob) {
  let failure: unknown
  try {
    await updateBackupJob(job, { status: 'running', startedAt: new Date().toISOString() })
    const snapshot = await createCompleteSnapshot(job.kind as 'manual' | 'scheduled', job.id, (phase) => updateBackupJob(job, { phase }), false, progressFor(job))
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
  let bundle: Awaited<ReturnType<typeof readCompleteBundle>> | undefined
  const input = resolve(UPLOAD_ROOT, `.complete-input-${job.id}`)
  const release = job.source ? pinBackupSource(job.source) : () => undefined
  try {
    await updateBackupJob(job, { status: 'running', phase: 'validating', startedAt: new Date().toISOString() })
    const { preview, artifact } = await readPreview(previewId, job.actorUserId!)
    await ensureUploadRoot()
    bundle = await readCompleteBundle(artifact.path, input, true, progressFor(job))
    job.warnings.push(...preview.warnings)
    await withMaintenanceLock('exclusive', async () => {
      try {
      await preparePluginRestore(bundle!.payload.data, job.id)
      const options = { actorUserId: job.actorUserId!, preserveSessionId: sessionId, replaceUsers: true }
      await unitOfWork.execute((tx) => inspectImportAccounts(tx, bundle!.payload, options), { mode: 'read', maxWait: DATABASE_TRANSACTION_MAX_WAIT_MS, timeout: DATABASE_TRANSACTION_TIMEOUT_MS })
      await updateBackupJob(job, { phase: 'protecting' })
      const protection = await createCompleteSnapshot('protect', randomUUID(), async () => { /* The surrounding restore owns the state lock. */ }, true)
      job.warnings.push(...protection.warnings ?? [])
      await updateBackupJob(job, { protectionId: protection.id, phase: 'restoring' })
      const journal = await prepareRestoreJournal(job.id, bundle!.uploads)
      let committed = false
      try {
        await switchRestoreFiles(journal)
        await unitOfWork.execute(async (tx) => {
          await importDatabaseRecords(tx, bundle!.payload, options)
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
        await rotateTelemetryEpoch(job.id)
        job.warnings.push(...await invalidateBackupCaches())
        try { await updateBackupJob(job, { phase: 'cleaning' }) } catch { job.warnings.push('JOB_STATE_WRITE_FAILED') }
        try { await reconcileRestoreJournal(journal, true) } catch { job.warnings.push('RESTORE_CLEANUP_FAILED') }
      }
      } finally { await reconcilePluginRestore(); await reloadPluginRegistry() }
    })
  } catch (error) { failure = error }
  finally { bundle?.store.close(); release(); try { await rm(input, { recursive: true, force: true }) } catch { job.warnings.push('WORK_CLEANUP_FAILED') } }
  await finishJob(job, failure)
}

export async function deleteBackupSnapshot(id: string, automatic = false) {
  if (!automatic && activeBackupJob()) throw new HttpError('A backup operation is already running', 409, 409, { reason: 'BACKUP_BUSY' })
  const release = reserveSnapshotDeletion(id)
  try {
    if ((await pinnedSnapshots()).has(id) || activeBackupJob()?.snapshotId === id) throw new HttpError('Backup is currently in use', 409, 409)
    const snapshot = await readJson<BackupSnapshot>(recordPath('snapshots', id))
    if (!snapshot || snapshot.id !== id) throw new HttpError('Backup not found', 404, 404)
    if (snapshot.kind === 'imported') await markImportedSnapshotDeleted(id)
    await rm(artifactPath(id), { force: true })
    await rm(recordPath('snapshots', id))
  } finally { release() }
}
export async function applyBackupRetention() {
  const settings = await readSettings(), pinned = await pinnedSnapshots()
  const snapshots = (await readRecords<BackupSnapshot>('snapshots')).filter((snapshot) => snapshot.kind === 'scheduled' && backupCompatibility(snapshot.manifest).status !== 'unsupported').sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  for (const snapshot of snapshots.slice(settings.retentionCount)) if (!pinned.has(snapshot.id)) await deleteBackupSnapshot(snapshot.id, true)
}
export async function backupHistory(): Promise<BackupHistoryResponse> {
  const snapshots = (await readRecords<BackupSnapshot>('snapshots')).sort((a, b) => (b.importedAt ?? b.createdAt).localeCompare(a.importedAt ?? a.createdAt)).map(snapshot => {
    const compatibility = backupCompatibility(snapshot.manifest)
    const restorable = compatibility.status !== 'unsupported'
    if (!restorable) {
      const legacy = snapshot.manifest as unknown as { files?: unknown[]; counts?: Record<string,number>; fileCount?: number; formatVersion?: number; databaseVersion?: string }
      return { ...snapshot, manifest: { formatVersion: legacy.formatVersion ?? 0, databaseVersion: legacy.databaseVersion ?? '', fileCount: legacy.fileCount ?? legacy.files?.length ?? 0, counts: legacy.counts ?? {} }, restorable, compatibility }
    }
    return { ...snapshot, restorable, compatibility }
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
