/**
 * @file recovery.ts
 * @project SlothVault
 * @module Coordinated Restore Recovery
 * @description Journals upload root moves and reconciles them against an atomic database commit receipt.
 * @logic Persist complete move intent before mutation, infer each move from its stage and rollback locations, and fail closed if recovery is ambiguous.
 * @dependencies Node filesystem, Prisma transaction client, private backup control store, upload root
 * @index_tags backup,restore,journal,rollback,crash-recovery
 * @author holic512
 */
import 'server-only'
import { mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { getDatabaseClient } from '@/server/database/client'
import { UPLOAD_ROOT } from '@/server/services/admin-files'
import { HttpError } from '@/server/http/errors'
import type { BackupJob } from '@/types/backup'
import { RESTORE_COMMIT_CONFIG_KEY, ZIP_ENTRY_LIMIT } from './constants'
import { collectStorageTree, ensureUploadRoot, lstatOrNull, resolveWithin, visibleRootNames } from './files-common'
import { atomicJson, backupStatePath, readJson, recordPath } from './store'
import { setBackupRecoveryError } from './recovery-state'

const name = z.string().min(1).max(1024).refine((value) => !value.startsWith('.') && !/[\/\\\0]/.test(value))
const journalSchema = z.object({
  jobId: z.string().uuid(),
  stage: z.string().regex(/^\.complete-restore-[a-f0-9-]{36}$/),
  rollback: z.string().regex(/^\.complete-rollback-[a-f0-9-]{36}$/),
  oldNames: z.array(name).max(ZIP_ENTRY_LIMIT), newNames: z.array(name).max(ZIP_ENTRY_LIMIT),
  resolution: z.enum(['pending', 'committed', 'rolledBack']),
}).strict().refine((journal) => journal.stage === `.complete-restore-${journal.jobId}` && journal.rollback === `.complete-rollback-${journal.jobId}` &&
  new Set(journal.oldNames).size === journal.oldNames.length && new Set(journal.newNames).size === journal.newNames.length)
export type RestoreJournal = z.infer<typeof journalSchema>
export function restoreJournalPath() { return resolve(backupStatePath(), 'restore.json') }
export async function readRestoreJournal() {
  const value = await readJson(restoreJournalPath())
  return value === null ? null : journalSchema.parse(value)
}
export async function syncDirectory(path: string) {
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}
async function durableMove(source: string, destination: string) {
  await rename(source, destination)
  await syncDirectory(resolve(source, '..'))
  if (resolve(source, '..') !== resolve(destination, '..')) await syncDirectory(resolve(destination, '..'))
}
export async function prepareRestoreJournal(jobId: string, stagedUploads: string) {
  await ensureUploadRoot()
  if (await readRestoreJournal()) throw new HttpError('Backup recovery requires maintenance', 503, 503)
  const journal: RestoreJournal = {
    jobId, stage: `.complete-restore-${jobId}`, rollback: `.complete-rollback-${jobId}`,
    oldNames: await visibleRootNames(), newNames: (await readdir(stagedUploads)).sort(), resolution: 'pending',
  }
  journalSchema.parse(journal)
  const stage = resolveWithin(UPLOAD_ROOT, journal.stage), rollback = resolveWithin(UPLOAD_ROOT, journal.rollback)
  if (await lstatOrNull(stage) || await lstatOrNull(rollback)) throw new HttpError('Restore staging conflicts with existing files', 409, 409)
  const entries = await collectStorageTree(stagedUploads)
  for (const entry of entries.filter((entry) => entry.kind === 'file')) {
    const handle = await open(entry.absolutePath, 'r')
    try { await handle.sync() } finally { await handle.close() }
  }
  for (const entry of entries.filter((entry) => entry.kind === 'directory').toReversed()) await syncDirectory(entry.absolutePath)
  await syncDirectory(stagedUploads)
  // Caller extracts beneath UPLOAD_ROOT so this rename cannot cross a filesystem.
  try {
    await durableMove(stagedUploads, stage)
    await mkdir(rollback, { mode: 0o700 })
    await syncDirectory(UPLOAD_ROOT)
    await atomicJson(restoreJournalPath(), journal)
  } catch (error) {
    // A published journal owns its material, even if its acknowledgement failed.
    if (!await readRestoreJournal()) {
      await rm(stage, { recursive: true, force: true }).catch(() => undefined)
      await rm(rollback, { recursive: true, force: true }).catch(() => undefined)
    }
    throw error
  }
  return journal
}
export async function switchRestoreFiles(journal: RestoreJournal) {
  const stage = resolveWithin(UPLOAD_ROOT, journal.stage), rollback = resolveWithin(UPLOAD_ROOT, journal.rollback)
  for (const entry of journal.oldNames) await durableMove(resolveWithin(UPLOAD_ROOT, entry), resolveWithin(rollback, entry))
  for (const entry of journal.newNames) await durableMove(resolveWithin(stage, entry), resolveWithin(UPLOAD_ROOT, entry))
}

export async function reconcileRestoreJournal(journal: RestoreJournal, committed: boolean) {
  const stage = resolveWithin(UPLOAD_ROOT, journal.stage), rollback = resolveWithin(UPLOAD_ROOT, journal.rollback)
  for (const directory of [stage, rollback]) {
    const info = await lstatOrNull(directory)
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('Unsafe restore recovery directory')
  }
  if (committed && journal.resolution === 'pending') {
    for (const entry of journal.newNames) {
      if (!await lstatOrNull(resolveWithin(UPLOAD_ROOT, entry)) || await lstatOrNull(resolveWithin(stage, entry))) throw new Error('Committed restore files are inconsistent')
    }
  } else if (!committed && journal.resolution === 'pending') {
    for (const entry of journal.newNames.toReversed()) {
      const staged = resolveWithin(stage, entry), live = resolveWithin(UPLOAD_ROOT, entry)
      if (!await lstatOrNull(staged)) {
        if (!await lstatOrNull(live)) throw new Error('Restore recovery file is missing')
        await durableMove(live, staged)
      }
    }
    for (const entry of journal.oldNames.toReversed()) {
      const previous = resolveWithin(rollback, entry), live = resolveWithin(UPLOAD_ROOT, entry)
      if (await lstatOrNull(previous)) {
        if (await lstatOrNull(live)) throw new Error('Restore recovery destination conflicts')
        await durableMove(previous, live)
      } else if (!await lstatOrNull(live)) throw new Error('Original restore file is missing')
    }
  }
  // Persist the recovery decision before deleting evidence; cleanup can then be retried safely.
  await atomicJson(restoreJournalPath(), { ...journal, resolution: committed ? 'committed' : 'rolledBack' })
  await rm(stage, { recursive: true, force: true })
  await rm(rollback, { recursive: true, force: true })
  await syncDirectory(UPLOAD_ROOT)
  await rm(restoreJournalPath(), { force: true })
  await syncDirectory(backupStatePath())
}

export async function recoverPendingRestore() {
  try {
    const journal = await readRestoreJournal()
    if (!journal) { setBackupRecoveryError(null); return }
    const receipt = journal.resolution === 'pending' ? await getDatabaseClient().systemConfig.findUnique({ where: { configKey: RESTORE_COMMIT_CONFIG_KEY } }) : null
    const committed = journal.resolution === 'committed' || receipt?.configValue === journal.jobId
    await reconcileRestoreJournal(journal, committed)
    const job = await readJson<BackupJob>(recordPath('jobs', journal.jobId))
    if (job) await atomicJson(recordPath('jobs', job.id), { ...job, status: committed ? 'succeeded' : 'interrupted', phase: committed ? 'complete' : job.phase, finishedAt: new Date().toISOString(), error: committed ? null : 'BACKUP_INTERRUPTED', warnings: [...job.warnings, 'RECOVERED_AFTER_RESTART'] })
    setBackupRecoveryError(null)
  } catch {
    setBackupRecoveryError('Backup recovery requires maintenance')
    throw new HttpError('Backup recovery requires maintenance', 503, 503)
  }
}
