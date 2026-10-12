/**
 * @file uploads.ts
 * @project SlothVault
 * @module Resumable Backup Uploads
 * @description Persists resumable uploads and coordinates their durable publication as imported snapshots.
 * @logic Acknowledge durable chunks, serialize upload transitions, journal verified publication, and reconcile restarts without expiring published snapshots.
 * @dependencies Node filesystem and streams, private backup control store, administrator session
 * @index_tags backup,upload,chunks,resume,offset,integrity
 * @author holic512
 */
import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, open, readdir, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import { HttpError } from '@/server/http/errors'
import type { BackupSnapshot, BackupUpload } from '@/types/backup'
import { BACKUP_UPLOAD_CHUNK_BYTES, BACKUP_UPLOAD_TTL_MS } from './constants'
import { artifactPath, atomicJson, ensureBackupStorage, importPath, pinnedImports, readJson, readRecords, recordPath, requireBackupId, sourceIsPinned } from './store'
import { requireFreeSpace, sha256File } from './archive'

export type BackupUploadRecord = BackupUpload & { id: string; actorUserId: number; sha256?: string; publication?: BackupSnapshot }
export const uploadInputSchema = z.object({ size:z.number().int().min(22).max(Number.MAX_SAFE_INTEGER),fileName:z.string().min(1).max(255),lastModified:z.number().int().nonnegative(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const locks = new Map<string, Promise<void>>()
async function exclusive<T>(id:string,operation:()=>Promise<T>) {
  const previous = locks.get(id) ?? Promise.resolve(); let release!:()=>void
  const next = new Promise<void>(done=>{release=done}), tail = previous.then(()=>next); locks.set(id,tail); await previous
  try { return await operation() } finally { release(); if (locks.get(id)===tail) locks.delete(id) }
}
const expires = () => new Date(Date.now()+BACKUP_UPLOAD_TTL_MS).toISOString()
function dto(record:BackupUploadRecord): BackupUpload { const {id:_id,actorUserId:_actor,sha256:_hash,publication:_publication,...result}=record; void _id;void _actor;void _hash;void _publication;return result }
async function syncParent(path:string) { const handle=await open(dirname(path),'r');try{await handle.sync()}finally{await handle.close()} }
async function getRecord(id:string,actorUserId:number) {
  requireBackupId(id)
  const record = await readJson<BackupUploadRecord>(recordPath('imports',id))
  if (!record || record.id!==id || record.actorUserId!==actorUserId || (new Date(record.expiresAt).getTime()<=Date.now() && !sourceIsPinned(id) && !(await pinnedImports()).has(id))) throw new HttpError('Backup upload is unavailable or expired',404,404,{reason:'BACKUP_UPLOAD_EXPIRED'})
  return record
}
/** Read durable ownership and task metadata without waiting for a long-running import's upload lock. */
export async function readBackupUploadRecord(id: string, actorUserId: number) {
  return getRecord(id, actorUserId)
}
async function reconcile(record:BackupUploadRecord) {
  if (record.snapshotId || record.publication) return // Publication recovery owns files that have left upload staging.
  const path=importPath(record.id),partial=path+'.partial'
  if (record.state==='uploaded') {
    const info=await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size!==record.size) throw new HttpError('Backup upload is inconsistent',409,409)
    return
  }
  let info:Awaited<ReturnType<typeof lstat>>
  try { info=await lstat(partial) } catch(error) {
    if ((error as NodeJS.ErrnoException).code!=='ENOENT' || record.offset!==record.size) throw error
    const completed=await lstat(path);if (!completed.isFile() || completed.isSymbolicLink() || completed.size!==record.size) throw new HttpError('Backup upload is inconsistent',409,409)
    record.state='uploaded';await atomicJson(recordPath('imports',record.id),record);return
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size<record.offset) throw new HttpError('Backup upload is inconsistent',409,409)
  if (info.size>record.offset) { const handle=await open(partial,'r+');try{await handle.truncate(record.offset);await handle.sync()}finally{await handle.close()} }
}
export async function withBackupUpload<T>(id: string, actorUserId: number, operation: (record: BackupUploadRecord) => Promise<T>) {
  return exclusive(id, async () => {
    const record = await getRecord(id, actorUserId)
    await reconcile(record)
    return operation(record)
  })
}

/** Caller holds the upload lock; the journal is durable before any file is moved. */
export async function publishBackupUpload(record: BackupUploadRecord): Promise<BackupSnapshot> {
  const snapshot = record.publication
  if (!snapshot || snapshot.id !== record.id || snapshot.kind !== 'imported') throw new HttpError('Invalid backup publication', 409, 409, { reason: 'BACKUP_INVALID' })
  const source = importPath(record.id), destination = artifactPath(snapshot.id)
  const existing = await readJson<BackupSnapshot>(recordPath('snapshots', snapshot.id))
  if (existing && (existing.id !== snapshot.id || existing.kind !== 'imported' || existing.sha256 !== snapshot.sha256)) throw new HttpError('Backup publication conflicts with an existing snapshot', 409, 409)
  const info = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  const candidate = info ? destination : source
  const candidateInfo = info ?? await lstat(source)
  if (!candidateInfo.isFile() || candidateInfo.isSymbolicLink() || candidateInfo.size !== snapshot.size || await sha256File(candidate) !== snapshot.sha256) throw new HttpError('Backup publication integrity verification failed', 409, 409, { reason: 'BACKUP_INVALID' })
  if (!info) await rename(source, destination)
  // Sync both directories even when recovering a rename whose acknowledgement was lost.
  await syncParent(source)
  await syncParent(destination)
  if (!existing) {
    try { await atomicJson(recordPath('snapshots', snapshot.id), snapshot) }
    catch (error) {
      // A directory-sync acknowledgement can fail after the index has already been committed.
      const committed = await readJson<BackupSnapshot>(recordPath('snapshots', snapshot.id)).catch(() => null)
      if (!committed || committed.sha256 !== snapshot.sha256) { throw error }
      (snapshot.warnings ??= []).push('JOB_STATE_WRITE_FAILED')
    }
  }
  record.snapshotId = snapshot.id
  delete record.publication
  try { await atomicJson(recordPath('imports', record.id), record) }
  catch { ((existing ?? snapshot).warnings ??= []).push('JOB_STATE_WRITE_FAILED') }
  return existing ?? snapshot
}

export async function markImportedSnapshotDeleted(id: string) {
  await exclusive(id, async () => {
    const record = await readJson<BackupUploadRecord>(recordPath('imports', id))
    if (!record) return
    // Clear a possible stale publication intent before deletion so restart cannot resurrect the node.
    record.snapshotId = id
    delete record.publication
    await atomicJson(recordPath('imports', id), record)
  })
}

async function removeUpload(record: BackupUploadRecord) {
  if (record.publication && !await readJson(recordPath('snapshots', record.id))) await rm(artifactPath(record.id), { force: true })
  await rm(importPath(record.id) + '.partial', { force: true })
  await rm(importPath(record.id), { force: true })
  await rm(recordPath('imports', record.id), { force: true })
}

export async function cleanupExpiredBackupUploads() {
  const pinned = await pinnedImports()
  for (const entry of await readRecords<BackupUploadRecord>('imports')) {
    await exclusive(entry.id, async () => {
      const record = await readJson<BackupUploadRecord>(recordPath('imports', entry.id))
      if (record && !pinned.has(record.id) && !sourceIsPinned(record.id) && new Date(record.expiresAt).getTime() <= Date.now()) await removeUpload(record)
    })
  }
}
export async function createBackupUpload(input:unknown,actorUserId:number):Promise<BackupUpload> {
  const body=uploadInputSchema.parse(input);await ensureBackupStorage();await requireFreeSpace(dirname(importPath(randomUUID())),BACKUP_UPLOAD_CHUNK_BYTES)
  const id=randomUUID(),record:BackupUploadRecord={id,importId:id,actorUserId,...body,offset:0,chunkSize:BACKUP_UPLOAD_CHUNK_BYTES,expiresAt:expires(),state:'uploading'}
  const path=importPath(id)+'.partial',handle=await open(path,'wx',0o600)
  try { await handle.sync();await handle.close();await syncParent(path);await atomicJson(recordPath('imports',id),record);return dto(record) }
  catch(error){await handle.close().catch(()=>undefined);if (!await readJson(recordPath('imports',id)).catch(()=>null)) await rm(path,{force:true});throw error}
}
export async function getBackupUpload(id:string,actorUserId:number) { return exclusive(id,async()=>{const record=await getRecord(id,actorUserId);await reconcile(record);return dto(record)}) }
export async function appendBackupUpload(id:string,actorUserId:number,request:Request) {
  return exclusive(id,async()=>{
    const record=await getRecord(id,actorUserId);await reconcile(record)
    const raw=request.headers.get('upload-offset'),expectedHash=request.headers.get('x-chunk-sha256')
    if (!raw || !/^\d+$/.test(raw) || !expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash) || !request.body || request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/octet-stream') throw new HttpError('Invalid backup chunk',400,400)
    const offset=Number(raw),length=Math.min(record.chunkSize,record.size-offset)
    if (!Number.isSafeInteger(offset) || offset>record.offset || offset<0 || length<=0 || record.state!=='uploading') throw new HttpError('Backup upload offset differs',409,409,{reason:'BACKUP_UPLOAD_OFFSET',offset:record.offset})
    const declared=request.headers.get('content-length')
    if (declared!==null && (!/^\d+$/.test(declared) || Number(declared)!==length)) throw new HttpError('Invalid backup chunk length',400,400)
    const path=importPath(id)+'.partial',chunk=path+'.'+randomUUID()+'.chunk',hash=createHash('sha256');let received=0
    await requireFreeSpace(dirname(path),length*2)
    const limiter=new Transform({transform(data:Buffer,_encoding,callback){received+=data.length;if(received>length)callback(new HttpError('Backup chunk exceeds its declared length',413,413));else{hash.update(data);callback(null,data)}}})
    try {
      await pipeline(Readable.fromWeb(request.body as import('node:stream/web').ReadableStream),limiter,createWriteStream(chunk,{flags:'wx',mode:0o600}))
      if(received!==length || hash.digest('hex')!==expectedHash) throw new HttpError('Backup chunk checksum or length differs',400,400,{reason:'BACKUP_UPLOAD_CHECKSUM'})
      if(offset<record.offset){
        if(offset+received>record.offset)throw new HttpError('Backup upload offset differs',409,409,{reason:'BACKUP_UPLOAD_OFFSET',offset:record.offset})
        const stored=createHash('sha256');for await(const bytes of createReadStream(path,{start:offset,end:offset+received-1}))stored.update(bytes)
        if(stored.digest('hex')!==expectedHash)throw new HttpError('Retried chunk differs',409,409,{reason:'BACKUP_UPLOAD_CHECKSUM'})
      }else{
        await pipeline(createReadStream(chunk),createWriteStream(path,{flags:'r+',start:offset}))
        const handle=await open(path,'r+');try{await handle.sync()}finally{await handle.close()}
        record.offset+=received
      }
      record.expiresAt=expires();await atomicJson(recordPath('imports',id),record);return dto(record)
    }finally{await rm(chunk,{force:true}).catch(()=>undefined)}
  })
}
export async function completeBackupUpload(id:string,actorUserId:number) {
  return exclusive(id,async()=>{
    const record=await getRecord(id,actorUserId);await reconcile(record)
    if(record.offset!==record.size)throw new HttpError('Backup upload is incomplete',409,409,{reason:'BACKUP_UPLOAD_INCOMPLETE'})
    if(record.state==='uploading'){await rename(importPath(id)+'.partial',importPath(id));await syncParent(importPath(id));record.state='uploaded'}
    record.expiresAt=expires();await atomicJson(recordPath('imports',id),record);return {importId:id}
  })
}
export async function cancelBackupUpload(id:string,actorUserId:number) {
  await getRecord(id, actorUserId)
  if (sourceIsPinned(id) || (await pinnedImports()).has(id)) throw new HttpError('Backup upload is currently in use', 409, 409)
  return exclusive(id,async()=>{
    const record = await getRecord(id,actorUserId)
    if(sourceIsPinned(id)||(await pinnedImports()).has(id))throw new HttpError('Backup upload is currently in use',409,409)
    await removeUpload(record)
  })
}
export async function reconcileBackupUploads() {
  const recoveredImports = new Map<string, string>()
  const pinned=await pinnedImports()
  const directory = dirname(importPath(randomUUID()))
  for (const name of await readdir(directory)) {
    if (/^[a-f0-9-]+\.zip\.partial\.[a-f0-9-]+\.chunk$/.test(name)) await rm(resolve(directory, name), {force:true})
    const orphan = /^([a-f0-9-]{36})\.zip\.partial$/.exec(name)
    if (orphan && !await readJson(recordPath('imports',orphan[1]))) await rm(resolve(directory,name),{force:true})
  }
  for(const record of await readRecords<BackupUploadRecord>('imports')){
    if(!record.state)continue
    await exclusive(record.id,async()=>{
      if (record.publication) {
        try {
          const snapshot = await publishBackupUpload(record)
          if (record.importJobId) recoveredImports.set(record.importJobId, snapshot.id)
        }
        catch (error) {
          if (error instanceof HttpError || (error as NodeJS.ErrnoException).code === 'ENOENT') return // Preserve inconsistent publication materials for retry or cancellation.
          throw error
        }
      }
      if(!pinned.has(record.id)&&!sourceIsPinned(record.id)&&new Date(record.expiresAt).getTime()<=Date.now()){
        await removeUpload(record)
      }else {
        try { await reconcile(record) } catch (error) {
          if (error instanceof HttpError && error.status === 409) return // Keep inconsistent materials available for explicit cancellation.
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          // A missing source invalidates this session without blocking unrelated backup jobs.
          await rm(recordPath('imports',record.id),{force:true})
        }
      }
    })
  }
  return recoveredImports
}
