/**
 * @file scheduler.ts
 * @project SlothVault
 * @module Local Backup Scheduler
 * @description Runs opt-in daily backups in a persistent single-instance Node.js server.
 * @logic Persist local-calendar trigger slots, register one timer, recover interrupted operations before traffic, and coalesce missed schedules into one backup.
 * @dependencies Intl time zones, private backup store, complete backup jobs, runtime installation health
 * @index_tags backup,scheduler,timezone,startup,retention,recovery
 * @author holic512
 */
import 'server-only'
import { readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { HttpError } from '@/server/http/errors'
import { withMaintenanceLock } from '@/server/services/maintenance-lock'
import { getDatabaseClient } from '@/server/database/client'
import { readRuntimeInstallationPublicStatus } from '@/server/database/runtime-health'
import { UPLOAD_ROOT } from '@/server/services/admin-files'
import type { BackupJob, BackupSettings, BackupSettingsResponse, RestorePreview } from '@/types/backup'
import { queueCompleteBackup, runCompleteBackup, failQueuedBackup } from './complete'
import { readRestoreJournal, recoverPendingRestore } from './recovery'
import { RESTORE_COMMIT_CONFIG_KEY } from './constants'
import { activeBackupJob, atomicJson, backupStatePath, backupStoragePath, ensureBackupStorage, getBackupSnapshot, importPath, pinnedImports, readJson, readRecords, readSettings, recordPath, settingsSchema, sourceIsPinned, storageStatus, workPath } from './store'

type ScheduleState = { signature: string; lastSlot: string; lastJobId?: string }
type SchedulerRuntime = { initialized?: Promise<void>; timer?: ReturnType<typeof setInterval>; ticking: boolean; saving: boolean }
const globalRuntime = globalThis as unknown as { slothVaultBackupScheduler?: SchedulerRuntime }
const runtime = globalRuntime.slothVaultBackupScheduler ??= { ticking: false, saving: false }
const schedulePath = () => resolve(backupStatePath(), 'schedule.json')
const signature = (settings: BackupSettings) => `${settings.timeZone}|${settings.dailyTime}`
function formatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}
function parts(format: Intl.DateTimeFormat, date: Date) {
  const values = Object.fromEntries(format.formatToParts(date).map((part) => [part.type, part.value]))
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` }
}
function adjacentDate(date: string, days: number) { return new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10) }
export function scheduledSlot(settings: BackupSettings, now = new Date()) {
  const local = parts(formatter(settings.timeZone), now)
  return local.time >= settings.dailyTime ? local.date : adjacentDate(local.date, -1)
}
export function nextBackupRun(settings: BackupSettings, now = new Date()) {
  if (!settings.enabled) return null
  const format = formatter(settings.timeZone), local = parts(format, now)
  const target = local.time < settings.dailyTime ? local.date : adjacentDate(local.date, 1)
  const start = Math.floor(now.getTime() / 60_000) * 60_000 + 60_000
  for (let minute = 0; minute < 49 * 60; minute++) {
    const candidate = new Date(start + minute * 60_000), at = parts(format, candidate)
    if (at.date >= target && at.time >= settings.dailyTime) return candidate.toISOString()
  }
  return null
}
export async function saveBackupSettings(input: unknown) {
  if (runtime.ticking || runtime.saving || activeBackupJob()) throw new HttpError('A backup operation is already running', 409, 409, { reason: 'BACKUP_BUSY' })
  runtime.saving = true
  try {
    const settings = settingsSchema.parse(input), previous = await readSettings()
    await ensureBackupStorage()
    if (settings.enabled && (!previous.enabled || signature(settings) !== signature(previous))) {
      await atomicJson(schedulePath(), { signature: signature(settings), lastSlot: scheduledSlot(settings) } satisfies ScheduleState)
    }
    await atomicJson(resolve(backupStatePath(), 'settings.json'), settings)
    return settings
  } finally { runtime.saving = false }
}
export async function backupSettingsResponse(): Promise<BackupSettingsResponse> {
  const settings = await readSettings()
  return { settings, storage: await storageStatus(), nextRunAt: nextBackupRun(settings) }
}
export async function tickBackupScheduler(now = new Date()) {
  if (runtime.ticking || runtime.saving || activeBackupJob()) return
  runtime.ticking = true
  try {
    if (await readRestoreJournal()) await withMaintenanceLock('exclusive', recoverPendingRestore)
    const settings = await readSettings()
    if (!settings.enabled || (await readRuntimeInstallationPublicStatus()).status !== 'INSTALLED') return
    const slot = scheduledSlot(settings, now)
    const schedule = await readJson<ScheduleState>(schedulePath())
    if (!schedule || schedule.signature !== signature(settings)) {
      await atomicJson(schedulePath(), { signature: signature(settings), lastSlot: slot } satisfies ScheduleState)
      return
    }
    if (slot < schedule.lastSlot) return
    if (slot === schedule.lastSlot) {
      const previous = schedule.lastJobId ? await readJson<BackupJob>(recordPath('jobs', schedule.lastJobId)) : null
      if (previous?.status !== 'interrupted') return
      if ((await readRecords<BackupJob>('jobs')).some((job) => job.retryOf === previous.id && job.status !== 'interrupted')) return
    }
    const job = await queueCompleteBackup(null, 'scheduled')
    try { await atomicJson(schedulePath(), { signature: signature(settings), lastSlot: slot, lastJobId: job.id } satisfies ScheduleState) }
    catch (error) { await failQueuedBackup(job, error); return }
    await runCompleteBackup(job)
  } finally { runtime.ticking = false }
}
async function cleanupExpiredInputs() {
  const now = Date.now()
  for (const preview of await readRecords<RestorePreview>('previews')) if (preview.id !== activeBackupJob()?.previewId && new Date(preview.expiresAt).getTime() <= now) await rm(recordPath('previews', preview.id), { force: true })
  const pinned = await pinnedImports()
  for (const upload of await readRecords<{ id: string; expiresAt: string }>('imports')) {
    if (!pinned.has(upload.id) && !sourceIsPinned(upload.id) && new Date(upload.expiresAt).getTime() <= now) {
      await rm(importPath(upload.id), { force: true }); await rm(recordPath('imports', upload.id), { force: true })
    }
  }
}
async function cleanupInterruptedWork() {
  for (const name of await readdir(resolve(backupStoragePath(), 'work'))) {
    if (z.string().uuid().safeParse(name).success) await rm(workPath(name), { recursive: true, force: true })
  }
  for (const directory of [backupStoragePath(), resolve(backupStoragePath(), 'imports')]) {
    for (const name of await readdir(/* turbopackIgnore: true */ directory)) if (name.endsWith('.zip.partial') && z.string().uuid().safeParse(name.slice(0, -12)).success) await rm(resolve(directory, name), { force: true })
  }
  let names: string[] = []
  try { names = await readdir(UPLOAD_ROOT) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  for (const name of names) if (/^\.complete-(?:input|restore|rollback)-[a-f0-9-]{36}$/.test(name)) await rm(resolve(UPLOAD_ROOT, name), { recursive: true, force: true })
}
export async function initializeBackupRuntime() {
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (runtime.initialized) return runtime.initialized
  if (activeBackupJob()) return
  runtime.initialized = (async () => {
    // Resolve the journal before removing any evidence, including when the database is unavailable.
    await recoverPendingRestore()
    await ensureBackupStorage()
    for (const job of await readRecords<BackupJob>('jobs')) {
      if (job.status !== 'queued' && job.status !== 'running') continue
      let completed = false
      if (job.kind === 'restore') {
        try { completed = (await getDatabaseClient().systemConfig.findUnique({ where: { configKey: RESTORE_COMMIT_CONFIG_KEY } }))?.configValue === job.id } catch { /* An absent journal means files were never switched or were fully reconciled. */ }
      } else {
        try { completed = (await getBackupSnapshot(job.id)).kind === job.kind } catch { /* An unpublished artifact is not a completed backup. */ }
      }
      await atomicJson(recordPath('jobs', job.id), { ...job, ...(completed && job.kind !== 'restore' ? { snapshotId: job.id } : {}), status: completed ? 'succeeded' : 'interrupted', phase: completed ? 'complete' : job.phase, error: completed ? null : 'BACKUP_INTERRUPTED', warnings: [...job.warnings, 'RECOVERED_AFTER_RESTART'], finishedAt: new Date().toISOString(), durationMs: Math.max(0, Date.now() - new Date(job.startedAt ?? job.createdAt).getTime()) })
    }
    await cleanupInterruptedWork()
    await cleanupExpiredInputs()
  })()
  try { await runtime.initialized } catch {
    runtime.initialized = undefined
    console.error('[backup] Backup runtime initialization could not complete')
  }
  if (!runtime.timer) {
    runtime.timer = setInterval(() => {
      void (async () => {
        if (!runtime.initialized) await initializeBackupRuntime()
        if (runtime.initialized) { await tickBackupScheduler(); await cleanupExpiredInputs() }
      })().catch(() => console.error('[backup] Scheduled backup check failed'))
    }, 60_000)
    runtime.timer.unref()
    if (runtime.initialized) void tickBackupScheduler().catch(() => console.error('[backup] Startup backup check failed'))
  }
}
