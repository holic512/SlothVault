/**
 * @file archive.ts
 * @project SlothVault
 * @module Complete Backup Archives
 * @description Creates and validates portable database, upload, and SHA-256 manifest bundles.
 * @logic Copy one coordinated snapshot, bound every archive, verify managed and frozen attachments, and publish only a successfully validated artifact.
 * @dependencies Node streams/filesystem, Archiver, portable database backup, ZIP validation, private backup storage
 * @index_tags backup,archive,snapshot,sha256,zip,integrity
 * @author holic512
 */
import 'server-only'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, constants as fsConstants } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, open, readFile, rename, rm, statfs } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import archiver from 'archiver'
import { z } from 'zod'
import packageJson from '../../../../package.json'
import { HttpError } from '@/server/http/errors'
import { withMaintenanceLock } from '@/server/services/maintenance-lock'
import type { BackupFile, BackupKind, BackupManifest, BackupPhase, BackupSnapshot } from '@/types/backup'
import { BACKUP_MANIFEST_MAX_BYTES, COMPLETE_BACKUP_MAX_BYTES, DATABASE_IMPORT_CONTENT_LENGTH_MAX_BYTES, ZIP_ENTRY_LIMIT, ZIP_ENTRY_MAX_BYTES, ZIP_FILE_MAX_BYTES } from './constants'
import { exportDatabaseBackup } from './database-export'
import { parseDatabaseImportPayload } from './database-validation'
import { extractZipToStaging } from './files-import'
import { assertContained } from './files-common'
import { archiveSizeLimiter, collectFilesExportEntries, createFilesExportArchive } from './files-export'
import { validateZipFile } from './zip-validation'
import { artifactPath, atomicJson, backupStoragePath, ensureBackupStorage, recordPath, workPath } from './store'

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const manifestSchema = z.object({
  formatVersion: z.literal(1), id: z.string().uuid(), createdAt: z.string().datetime(),
  appVersion: z.string().min(1).max(80), databaseVersion: z.string().min(1).max(20),
  counts: z.record(z.string().max(80), z.number().int().min(0).max(100_000)),
  files: z.array(z.object({ path: z.string().min(1).max(1024), size: z.number().int().min(0).max(ZIP_ENTRY_MAX_BYTES), sha256: digestSchema }).strict()).max(ZIP_ENTRY_LIMIT),
  databaseSha256: digestSchema, filesSha256: digestSchema,
}).strict()
function invalid(): never { throw new HttpError('Complete backup integrity verification failed', 400, 400, { reason: 'BACKUP_INVALID' }) }
export async function sha256File(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
async function writeArchive(archive: archiver.Archiver, path: string, limit: number) {
  archive.on('warning', (error) => archive.destroy(error))
  const writing = pipeline(archive, archiveSizeLimiter(limit), createWriteStream(path, { flags: 'wx', mode: 0o600 }))
  await Promise.all([writing, archive.finalize()])
}
function validateManagedBytes(payload: ReturnType<typeof parseDatabaseImportPayload>, files: BackupFile[]) {
  const byPath = new Map(files.map((file) => [file.path, file]))
  const metadata = new Map(payload.data.fileManagements.map((file) => [file.id, file]))
  for (const file of metadata.values()) {
    const actual = byPath.get(file.filePath.slice('uploads/'.length))
    if (!actual || BigInt(actual.size) !== BigInt(file.fileSize)) throw new HttpError('A managed backup attachment is missing or has a different size', 409, 409, { reason: 'BACKUP_ATTACHMENT_MISMATCH' })
  }
  for (const file of payload.data.commissionFiles) {
    const stored = metadata.get(file.fileId)
    if (!stored || byPath.get(stored.filePath.slice('uploads/'.length))?.sha256 !== file.sha256) throw new HttpError('A frozen backup attachment has a different hash', 409, 409, { reason: 'BACKUP_ATTACHMENT_MISMATCH' })
  }
  for (const contract of payload.data.contracts) {
    if (!contract.attachmentFileId || !contract.attachmentHash) continue
    const stored = metadata.get(contract.attachmentFileId)
    if (!stored || byPath.get(stored.filePath.slice('uploads/'.length))?.sha256 !== contract.attachmentHash) throw new HttpError('A frozen backup attachment has a different hash', 409, 409, { reason: 'BACKUP_ATTACHMENT_MISMATCH' })
  }
}

export async function readCompleteBundle(path: string, directory: string) {
  const info = await lstat(path)
  if (!info.isFile() || info.size > COMPLETE_BACKUP_MAX_BYTES) throw new HttpError('Complete backup exceeds the size limit', 413, 413)
  const entries = await validateZipFile(path, COMPLETE_BACKUP_MAX_BYTES)
  const limits: Record<string, number> = { 'database.json': DATABASE_IMPORT_CONTENT_LENGTH_MAX_BYTES, 'files.zip': ZIP_FILE_MAX_BYTES, 'manifest.json': BACKUP_MANIFEST_MAX_BYTES }
  if (entries.length !== 3 || entries.some((entry) => entry.kind !== 'file' || !Object.hasOwn(limits, entry.relativePath) || entry.declaredSize > limits[entry.relativePath])) invalid()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await extractZipToStaging(entries, directory)
  const databasePath = resolve(directory, 'database.json'), filesPath = resolve(directory, 'files.zip')
  let manifest: BackupManifest
  let database: { version: string; data: Record<string, unknown> }
  try {
    manifest = manifestSchema.parse(JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')))
    database = z.object({ version: z.string(), data: z.record(z.string(), z.unknown()), exportedAt: z.iso.datetime({ offset: true }).optional() }).strict().parse(JSON.parse(await readFile(databasePath, 'utf8')))
  } catch { invalid() }
  if (manifest.databaseVersion !== database.version || await sha256File(databasePath) !== manifest.databaseSha256 || await sha256File(filesPath) !== manifest.filesSha256) invalid()
  const payload = parseDatabaseImportPayload({ version: database.version, data: database.data, mode: 'overwrite' })
  const counts = Object.fromEntries(Object.entries(database.data).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, (value as unknown[]).length]))
  if (Object.keys(counts).length !== Object.keys(manifest.counts).length || Object.entries(counts).some(([key, count]) => manifest.counts[key] !== count)) invalid()
  const fileEntries = await validateZipFile(filesPath)
  const actualFiles = fileEntries.filter((entry) => entry.kind === 'file')
  const expected = new Map(manifest.files.map((file) => [file.path, file]))
  if (expected.size !== manifest.files.length || actualFiles.length !== expected.size || actualFiles.some((entry) => expected.get(entry.relativePath)?.size !== entry.declaredSize)) invalid()
  const uploads = resolve(directory, 'uploads')
  await mkdir(uploads, { mode: 0o700 })
  const available = await statfs(directory, { bigint: true })
  const needed = actualFiles.reduce((total, file) => total + BigInt(file.declaredSize), 0n)
  if (available.bavail * available.bsize < needed) throw new HttpError('Insufficient backup storage space', 507, 507, { reason: 'STORAGE_FULL' })
  await extractZipToStaging(fileEntries, uploads)
  for (const entry of actualFiles) {
    if (await sha256File(assertContained(uploads, resolve(uploads, ...entry.segments))) !== expected.get(entry.relativePath)!.sha256) invalid()
  }
  validateManagedBytes(payload, manifest.files)
  return { manifest, payload, uploads }
}

export async function createCompleteSnapshot(kind: BackupKind, id: string, phase: (value: BackupPhase) => Promise<void>, lockHeld = false): Promise<BackupSnapshot> {
  await ensureBackupStorage()
  const directory = workPath(id), uploads = resolve(directory, 'uploads'), partial = `${artifactPath(id)}.partial`
  await mkdir(directory, { mode: 0o700 })
  await mkdir(uploads, { mode: 0o700 })
  let published: BackupSnapshot | undefined
  try {
    await phase('copying')
    const copySnapshot = async () => {
      const database = await exportDatabaseBackup()
      const entries = await collectFilesExportEntries()
      const files: BackupFile[] = []
      const bytes = (await Promise.all(entries.filter((entry) => entry.kind === 'file').map(async (entry) => (await lstat(entry.absolutePath)).size))).reduce((total, size) => total + BigInt(size), 0n)
      const available = await statfs(directory, { bigint: true })
      if (available.bavail * available.bsize < bytes * 5n + BigInt(BACKUP_MANIFEST_MAX_BYTES * 2 + DATABASE_IMPORT_CONTENT_LENGTH_MAX_BYTES * 3)) throw new HttpError('Insufficient backup storage space', 507, 507, { reason: 'STORAGE_FULL' })
      for (const entry of entries) {
        const destination = assertContained(uploads, resolve(uploads, entry.relativePath))
        if (entry.kind === 'directory') await mkdir(destination, { recursive: true, mode: 0o700 })
        else {
          await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
          await copyFile(entry.absolutePath, destination, fsConstants.COPYFILE_EXCL)
          await chmod(destination, 0o600)
          files.push({ path: entry.relativePath, size: (await lstat(destination)).size, sha256: await sha256File(destination) })
        }
      }
      validateManagedBytes(parseDatabaseImportPayload({ version: database.version, data: database.data, mode: 'overwrite' }), files)
      await atomicJson(resolve(directory, 'database.json'), database)
      return { database, files }
    }
    const { database, files } = lockHeld ? await copySnapshot() : await withMaintenanceLock('shared', copySnapshot)
    await phase('compressing')
    await writeArchive(await createFilesExportArchive(uploads), resolve(directory, 'files.zip'), ZIP_FILE_MAX_BYTES)
    const manifest: BackupManifest = {
      formatVersion: 1, id, createdAt: database.exportedAt, appVersion: process.env.SLOTHVAULT_APP_VERSION || packageJson.version, databaseVersion: database.version,
      counts: Object.fromEntries(Object.entries(database.data).map(([key, rows]) => [key, rows.length])), files,
      databaseSha256: await sha256File(resolve(directory, 'database.json')), filesSha256: await sha256File(resolve(directory, 'files.zip')),
    }
    if (Buffer.byteLength(JSON.stringify(manifest)) > BACKUP_MANIFEST_MAX_BYTES) throw new HttpError('Backup manifest exceeds the size limit', 413, 413)
    await atomicJson(resolve(directory, 'manifest.json'), manifest)
    const bundle = archiver('zip', { store: true })
    for (const name of ['database.json', 'files.zip', 'manifest.json']) bundle.file(resolve(directory, name), { name })
    await writeArchive(bundle, partial, COMPLETE_BACKUP_MAX_BYTES)
    await phase('validating')
    await readCompleteBundle(partial, resolve(directory, 'verify'))
    const handle = await open(partial, 'r')
    try { await handle.sync() } finally { await handle.close() }
    const snapshot: BackupSnapshot = { id, kind, createdAt: manifest.createdAt, size: (await lstat(partial)).size, sha256: await sha256File(partial), manifest }
    await rename(partial, artifactPath(id))
    const parent = await open(backupStoragePath(), 'r')
    try { await parent.sync() } finally { await parent.close() }
    await atomicJson(recordPath('snapshots', id), snapshot)
    published = snapshot
    return snapshot
  } finally {
    for (const path of [directory, partial]) {
      try { await rm(path, { recursive: true, force: true }) }
      catch { if (published) (published.warnings ??= []).push('WORK_CLEANUP_FAILED') }
    }
    if (published?.warnings?.length) {
      try { await atomicJson(recordPath('snapshots', id), published) } catch { published.warnings.push('JOB_STATE_WRITE_FAILED') }
    }
  }
}
