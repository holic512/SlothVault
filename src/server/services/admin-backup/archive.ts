/**
 * @file archive.ts
 * @project SlothVault
 * @module Complete Backup Archives
 * @description Creates and validates current single-layer ZIP64 business snapshots.
 * @logic Resolve registered data adapters, verify original archive bytes into a temporary record index, and publish only validated immutable snapshots.
 * @dependencies Node streams/filesystem, Archiver, Unzipper, backup compatibility, portable record store, maintenance lock
 * @index_tags backup,zip64,ndjson,snapshot,sha256,integrity
 * @author holic512
 */
import 'server-only'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, constants as fsConstants } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, open, opendir, rename, rm, statfs } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { once } from 'node:events'
import archiver from 'archiver'
import { z } from 'zod'
import packageJson from '../../../../package.json'
import { HttpError } from '@/server/http/errors'
import { withMaintenanceLock } from '@/server/services/maintenance-lock'
import { UPLOAD_ROOT } from '@/server/services/admin-files'
import type { BackupEntryDigest, BackupGenerationKind, BackupManifest, BackupPhase, BackupProgress, BackupSnapshot } from '@/types/backup'
import { ACTIVE_BACKUP_COLLECTION_KEYS, BACKUP_MANIFEST_MAX_BYTES, DATABASE_BACKUP_VERSION, ZIP_PATH_MAX_BYTES } from './constants'
import { exportDatabaseSnapshot } from './database-export'
import { requireBackupCompatibility } from './compatibility'
import { verifyBackupPublications } from './publication-validation'
import { validateBackupRelations } from './database-validation'
import { assertContained, nodeErrorHasCode, toArchivePath, type StorageTreeEntry } from './files-common'
import { RecordStore } from './record-store'
import { updateCrc32, validateZipFile, type ValidatedZipEntry } from './zip-validation'
import { artifactPath, atomicJson, ensureBackupStorage, recordPath, workPath } from './store'

const digest = z.object({ size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const manifestSchema = z.object({
  formatVersion: z.literal(2), id: z.string().uuid(), createdAt: z.string().datetime(), appVersion: z.string().min(1).max(80), databaseVersion: z.string().min(1).max(80),
  counts: z.record(z.string(), integer), database: z.record(z.string(), digest), filesIndex: digest, fileCount: integer, entryCount: integer, totalFileBytes: integer,
}).strict()
const fileSchema = z.object({ path: z.string().min(1).max(ZIP_PATH_MAX_BYTES), kind: z.enum(['file','directory']), size: integer, sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict()
function invalid(): never { throw new HttpError('Complete backup integrity verification failed', 400, 400, { reason: 'BACKUP_INVALID' }) }
export function unsupportedBackup(): never { throw new HttpError('Unsupported backup format', 400, 400, { reason: 'BACKUP_UNSUPPORTED_FORMAT' }) }
export async function sha256File(path: string) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex') }
export async function requireFreeSpace(path: string, bytes: number | bigint) {
  const info = await statfs(path, { bigint: true })
  if (info.bavail * info.bsize < BigInt(bytes) + 256n * 1024n * 1024n) throw new HttpError('Insufficient backup storage space', 507, 507, { reason: 'STORAGE_FULL' })
}
export async function* walkBackupFiles(root = UPLOAD_ROOT, current = root, postOrder = false): AsyncGenerator<StorageTreeEntry> {
  try {
    const stats = await lstat(current)
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new HttpError('Unsafe upload directory', 409, 409)
  } catch (error) { if (current === root && nodeErrorHasCode(error, 'ENOENT')) return; throw error }
  const entries = await opendir(current)
  for await (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const path = assertContained(root, resolve(current, entry.name)), stats = await lstat(path), relativePath = toArchivePath(root, path)
    if (/[\\\0\uFFFD]/.test(entry.name) || /^[A-Za-z]:/.test(relativePath) || Buffer.byteLength('uploads/' + relativePath + (stats.isDirectory() ? '/' : '')) > ZIP_PATH_MAX_BYTES) throw new HttpError('Uploads contain an unsupported path', 409, 409)
    if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) throw new HttpError('Uploads contain a symlink or special entry', 409, 409)
    const item: StorageTreeEntry = { absolutePath: path, relativePath, kind: stats.isDirectory() ? 'directory' : 'file' }
    if (!stats.isDirectory() || !postOrder) yield item
    if (stats.isDirectory()) { yield* walkBackupFiles(root, path, postOrder); if (postOrder) yield item }
  }
}
async function* checkedEntry(item: ValidatedZipEntry, hash = createHash('sha256')): AsyncGenerator<Buffer> {
  let size = 0, crc = 0xffffffff
  try {
    for await (const chunk of item.entry.stream()) {
      const bytes = Buffer.from(chunk); size += bytes.length
      if (size > item.declaredSize) invalid()
      crc = updateCrc32(crc, bytes); hash.update(bytes); yield bytes
    }
  } catch (error) { if (error instanceof HttpError || ['ENOSPC','EDQUOT','EACCES','EIO'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; invalid() }
  if (size !== item.declaredSize || ((crc ^ 0xffffffff) >>> 0) !== (item.entry.crc32 >>> 0)) invalid()
}
async function* ndjson(source: AsyncIterable<Buffer>, maxLineBytes = 8 * 1024 * 1024): AsyncGenerator<unknown> {
  let pending = Buffer.alloc(0)
  for await (const chunk of source) {
    let start = 0, end: number
    while ((end = chunk.indexOf(10, start)) !== -1) {
      if (pending.length + end - start > maxLineBytes) invalid()
      const line = pending.length ? Buffer.concat([pending, chunk.subarray(start,end)]) : chunk.subarray(start,end)
      if (!line.length) invalid()
      try { yield JSON.parse(line.toString('utf8')) } catch { invalid() }
      pending = Buffer.alloc(0); start = end + 1
    }
    if (pending.length + chunk.length - start > maxLineBytes) invalid()
    if (start < chunk.length) pending = Buffer.concat([pending, chunk.subarray(start)])
  }
  if (pending.length) invalid()
}
function checkDigest(hash: ReturnType<typeof createHash>, item: ValidatedZipEntry, expected: BackupEntryDigest) { if (item.declaredSize !== expected.size || hash.digest('hex') !== expected.sha256) invalid() }
function checkManagedFiles(store: RecordStore) {
  for (const file of store.iterate<{ id:string; filePath:string; fileSize:string }>('fileManagements')) {
    const actual = store.get<{kind:string;size:number;sha256:string}>('$files', file.filePath.slice(8))
    if (!actual || actual.kind !== 'file' || BigInt(actual.size) !== BigInt(file.fileSize)) throw new HttpError('A managed backup attachment is missing or has a different size', 409, 409, { reason: 'BACKUP_ATTACHMENT_MISMATCH' })
  }
  for (const row of store.iterate<{fileId:string;sha256:string}>('commissionFiles')) {
    const file = store.get<{filePath:string}>('fileManagements',row.fileId)
    if (!file || store.get<{sha256:string}>('$files',file.filePath.slice(8))?.sha256 !== row.sha256) throw new HttpError('A frozen backup attachment has a different hash',409,409,{reason:'BACKUP_ATTACHMENT_MISMATCH'})
  }
  for (const row of store.iterate<{attachmentFileId:string|null;attachmentHash:string|null}>('contracts')) {
    if (!row.attachmentFileId || !row.attachmentHash) continue
    const file = store.get<{filePath:string}>('fileManagements',row.attachmentFileId)
    if (!file || store.get<{sha256:string}>('$files',file.filePath.slice(8))?.sha256 !== row.attachmentHash) throw new HttpError('A frozen backup attachment has a different hash',409,409,{reason:'BACKUP_ATTACHMENT_MISMATCH'})
  }
}
export async function readCompleteBundle(path: string, directory: string, extract = true, progress?: (value: Partial<BackupProgress>) => Promise<void>) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) invalid()
  const source = await open(path, 'r'), signature = Buffer.alloc(4)
  try {
    const read = await source.read(signature, 0, signature.length, 0)
    if (read.bytesRead !== signature.length || ![0x04034b50, 0x06054b50].includes(signature.readUInt32LE(0))) unsupportedBackup()
  } finally { await source.close() }
  const entries = await validateZipFile(path), byPath = new Map(entries.map(entry => [entry.relativePath, entry]))
  const header = byPath.get('manifest.json')
  if (!header || header.kind !== 'file' || header.declaredSize > BACKUP_MANIFEST_MAX_BYTES) unsupportedBackup()
  const pieces: Buffer[] = []
  for await (const chunk of checkedEntry(header)) pieces.push(chunk)
  let raw: unknown
  try { raw = JSON.parse(Buffer.concat(pieces).toString('utf8')) } catch { invalid() }
  const adapter = requireBackupCompatibility((raw ?? {}) as { formatVersion?: unknown; databaseVersion?: unknown })
  const parsed = manifestSchema.safeParse(raw)
  if (!parsed.success) invalid()
  const manifest = parsed.data
  const keys = new Set(adapter.collectionKeys)
  if (Object.keys(manifest.counts).length !== keys.size || Object.keys(manifest.database).length !== keys.size || [...keys].some(key => !Object.hasOwn(manifest.counts,key) || !Object.hasOwn(manifest.database,key)) || entries.length !== keys.size + 2 + manifest.entryCount) invalid()
  await mkdir(directory,{recursive:true,mode:0o700})
  await requireFreeSpace(directory, extract ? manifest.totalFileBytes : 0)
  const store = new RecordStore(resolve(directory,'index.sqlite')), uploads = resolve(directory,'uploads')
  try {
    let processedRecords = 0, processedBytes = 0, processedFiles = 0
    for (const key of keys) {
      const item = byPath.get(`database/${key}.ndjson`)
      if (!item || item.kind !== 'file') invalid()
      const hash = createHash('sha256'); let count = 0
      for await (const value of ndjson(checkedEntry(item,hash))) {
        try { store.put(key,adapter.parseRow(key,value)) } catch { invalid() }
        count++; processedRecords++
        if (count % 100 === 0) await progress?.({processedRecords})
      }
      if (count !== manifest.counts[key]) invalid()
      checkDigest(hash,item,manifest.database[key]); processedBytes += item.declaredSize
    }
    const index = byPath.get('files.ndjson'); if (!index || index.kind !== 'file') invalid()
    const indexHash = createHash('sha256'); let count = 0, bytes = 0, files = 0
    for await (const value of ndjson(checkedEntry(index,indexHash), 4096)) {
      const parsedFile = fileSchema.safeParse(value); if (!parsedFile.success) invalid()
      const row = parsedFile.data, entry = byPath.get('uploads/' + row.path)
      if (!entry || entry.kind !== row.kind || entry.declaredSize !== row.size || (row.kind === 'directory' ? row.size !== 0 || row.sha256 !== null : row.sha256 === null)) invalid()
      try { store.put('$files',{id:row.path,...row}) } catch { invalid() }
      count++; bytes += row.size; if (!Number.isSafeInteger(bytes)) invalid(); if (row.kind === 'file') files++
    }
    checkDigest(indexHash,index,manifest.filesIndex)
    if (count !== manifest.entryCount || files !== manifest.fileCount || bytes !== manifest.totalFileBytes) invalid()
    for (const item of entries) {
      if (!item.relativePath.startsWith('uploads/')) { if (!['manifest.json','files.ndjson',...Array.from(keys,key=>`database/${key}.ndjson`)].includes(item.relativePath)) invalid(); continue }
      const row = store.get<{size:number;sha256:string|null}>('$files',item.relativePath.slice(8)); if (!row) invalid()
      const target = assertContained(uploads,resolve(uploads,...item.segments.slice(1)))
      if (item.kind === 'directory') { for await (const chunk of checkedEntry(item)) if (chunk.length) invalid(); if (extract) await mkdir(target,{recursive:true,mode:0o700}); continue }
      const hash = createHash('sha256')
      if (extract) {
        await requireFreeSpace(directory,item.declaredSize); await mkdir(dirname(target),{recursive:true,mode:0o700})
        await pipeline(Readable.from(checkedEntry(item,hash)),createWriteStream(target,{flags:'wx',mode:0o600}))
        processedBytes += item.declaredSize
      } else for await (const chunk of checkedEntry(item,hash)) { processedBytes += chunk.length; await progress?.({processedBytes,processedFiles,processedRecords}) }
      if (hash.digest('hex') !== row.sha256) invalid()
      processedFiles++; await progress?.({processedBytes,processedFiles,processedRecords,totalFiles:manifest.fileCount})
    }
    if (extract) await mkdir(uploads,{recursive:true,mode:0o700})
    const payload = adapter.toCurrentPayload(store)
    validateBackupRelations(payload.data); verifyBackupPublications(payload.data); checkManagedFiles(store)
    return {manifest,payload,uploads,store}
  } catch(error) { store.close(); throw error }
}
/** Let Archiver's retained directory metadata become collectible before opening the verification reader. */
async function writeSnapshotZip(directory: string, uploads: string, partial: string) {
  const archive = archiver('zip',{forceZip64:true,zlib:{level:1}}), hash = createHash('sha256')
  archive.on('warning',error=>archive.destroy(error))
  const hashing = new Transform({transform(chunk:Buffer,_encoding,callback){hash.update(chunk);callback(null,chunk)}})
  const writing = pipeline(archive,hashing,createWriteStream(partial,{flags:'wx',mode:0o600}))
  void writing.catch(error => archive.destroy(error))
  const append = async (path:string,name:string,directoryEntry=false) => {
    const appended = once(archive,'entry')
    if (directoryEntry) archive.append('',{name:name+'/'}); else archive.file(path,{name})
    await appended
  }
  try {
    await append(resolve(directory,'manifest.json'),'manifest.json')
    for (const key of ACTIVE_BACKUP_COLLECTION_KEYS) await append(resolve(directory,'database',`${key}.ndjson`),`database/${key}.ndjson`)
    await append(resolve(directory,'files.ndjson'),'files.ndjson')
    for await (const entry of walkBackupFiles(uploads)) await append(entry.absolutePath,'uploads/'+entry.relativePath,entry.kind==='directory')
    await Promise.all([writing,archive.finalize()])
  } catch(error) { archive.destroy(error as Error); await writing.catch(()=>undefined); throw error }
  return hash.digest('hex')
}

export async function createCompleteSnapshot(kind: BackupGenerationKind, id: string, phase: (value: BackupPhase) => Promise<void>, lockHeld = false, progress?: (value: Partial<BackupProgress>) => Promise<void>): Promise<BackupSnapshot> {
  await ensureBackupStorage()
  const directory = workPath(id), uploads = resolve(directory,'uploads'), partial = `${artifactPath(id)}.partial`
  await mkdir(uploads,{recursive:true,mode:0o700})
  const store = new RecordStore(resolve(directory,'index.sqlite'))
  let published: BackupSnapshot | undefined
  try {
    await phase('copying')
    const copySnapshot = async () => {
      const database = await exportDatabaseSnapshot(directory,store,progress)
      const handle = await open(resolve(directory,'files.ndjson'),'wx',0o600), hash = createHash('sha256')
      let fileCount = 0, entryCount = 0, totalFileBytes = 0, indexBytes = 0
      const paths = store.set()
      try {
        for await (const entry of walkBackupFiles()) {
          const key = entry.relativePath.toLocaleLowerCase('en-US'); if (paths.has(key)) throw new HttpError('Duplicate upload path',409,409); paths.add(key)
          const destination = assertContained(uploads,resolve(uploads,entry.relativePath))
          let size = 0, sha256: string | null = null
          if (entry.kind === 'directory') await mkdir(destination,{recursive:true,mode:0o700})
          else {
            size = (await lstat(entry.absolutePath)).size; await requireFreeSpace(directory,size); await mkdir(dirname(destination),{recursive:true,mode:0o700})
            await copyFile(entry.absolutePath,destination,fsConstants.COPYFILE_EXCL); await chmod(destination,0o600); sha256 = await sha256File(destination)
            if ((await lstat(destination)).size !== size) throw new HttpError('Attachment changed during snapshot',409,409)
            fileCount++; totalFileBytes += size
          }
          const row = {path:entry.relativePath,kind:entry.kind,size,sha256}, line = Buffer.from(JSON.stringify(row)+'\n')
          store.put('$files',{id:row.path,...row}); await handle.writeFile(line); hash.update(line); indexBytes += line.length; entryCount++
          await progress?.({processedFiles:fileCount,processedBytes:totalFileBytes})
        }
        await handle.sync()
      } finally { await handle.close() }
      checkManagedFiles(store)
      return { database, fileCount, entryCount, totalFileBytes, filesIndex:{size:indexBytes,sha256:hash.digest('hex')} }
    }
    const snapshot = lockHeld ? await copySnapshot() : await withMaintenanceLock('shared',copySnapshot)
    const manifest: BackupManifest = {formatVersion:2,id,createdAt:snapshot.database.exportedAt,appVersion:process.env.SLOTHVAULT_APP_VERSION||packageJson.version,databaseVersion:DATABASE_BACKUP_VERSION,counts:snapshot.database.counts,database:snapshot.database.database,filesIndex:snapshot.filesIndex,fileCount:snapshot.fileCount,entryCount:snapshot.entryCount,totalFileBytes:snapshot.totalFileBytes}
    await atomicJson(resolve(directory,'manifest.json'),manifest)
    await phase('compressing'); await requireFreeSpace(directory,snapshot.totalFileBytes+Object.values(manifest.database).reduce((sum,row)=>sum+row.size,0))
    const archiveSha256 = await writeSnapshotZip(directory,uploads,partial)
    await phase('validating')
    const verified = await readCompleteBundle(partial,resolve(directory,'verify'),false,progress); verified.store.close()
    const handle = await open(partial,'r'); try { await handle.sync() } finally { await handle.close() }
    const result: BackupSnapshot = {id,kind,createdAt:manifest.createdAt,size:(await lstat(partial)).size,sha256:archiveSha256,manifest}
    await rename(partial,artifactPath(id))
    const parent = await open(dirname(artifactPath(id)),'r'); try { await parent.sync() } finally { await parent.close() }
    await atomicJson(recordPath('snapshots',id),result); published = result
    return result
  } finally {
    store.close()
    for (const path of [directory,partial]) try { await rm(path,{recursive:true,force:true}) } catch { if (published) (published.warnings??=[]).push('WORK_CLEANUP_FAILED') }
    if (published?.warnings?.length) try { await atomicJson(recordPath('snapshots',id),published) } catch { published.warnings.push('JOB_STATE_WRITE_FAILED') }
  }
}
