/**
 * @file publication-validation.ts
 * @project SlothVault
 * @module Backup Publication Integrity
 * @description Verifies published content hashes using bounded disk collection views.
 * @logic Sort canonical note digests on disk, stream category JSON into SHA-256, and compare the immutable publication manifest.
 * @dependencies backup record store, release manifest protocol, Node crypto
 * @index_tags backup,publication,stream,integrity,manifest
 * @author holic512
 */
import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { HttpError } from '@/server/http/errors'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { canonicalReleaseManifest, parseReleaseManifest, releaseManifestHash } from '@/server/services/release-manifest'
import type { BackupData } from './database-schema'
import { recordStore, recordWhere, type RecordStore } from './record-store'

type Category = { id: string; name: string; notes: string }
type Note = { id: string; title: string; hash: string }
const byteCompare = (left: string, right: string) => Buffer.compare(Buffer.from(left), Buffer.from(right))
function* noteJson(store: RecordStore, collection: string) {
  yield '['
  let comma = ''
  for (const row of store.rows<Note>(collection)) {
    yield comma + JSON.stringify({ title: row.title, hash: row.hash }); comma = ','
  }
  yield ']'
}
/** Compare canonical byte streams without combining an entire category's notes. */
function compareStreams(left: Iterable<string>, right: Iterable<string>) {
  const a = left[Symbol.iterator](), b = right[Symbol.iterator]()
  let x = Buffer.alloc(0), y = Buffer.alloc(0), doneA = false, doneB = false
  while (true) {
    if (!x.length && !doneA) { const next = a.next(); doneA = Boolean(next.done); x = Buffer.from(next.value ?? '') }
    if (!y.length && !doneB) { const next = b.next(); doneB = Boolean(next.done); y = Buffer.from(next.value ?? '') }
    if (!x.length || !y.length) { if (doneA || doneB) return x.length ? 1 : y.length ? -1 : 0; continue }
    const length = Math.min(x.length, y.length), compare = Buffer.compare(x.subarray(0, length), y.subarray(0, length))
    if (compare) return compare
    x = x.subarray(length); y = y.subarray(length)
  }
}
export function verifyBackupPublications(data: BackupData) {
  const store = recordStore(data.projectVersions)
  if (!store) throw new Error('Publication validation requires a disk record index')
  for (const version of data.projectVersions) {
    if (!version.publishedAt) continue
    const snapshot = parseReleaseManifest(version.releaseManifestJson), scope = '$publication-' + randomUUID()
    let categoryCount = 0
    const fail = (): never => { throw new HttpError('Backup release integrity verification failed', 409, 409, { reason: 'BACKUP_RELEASE_INTEGRITY_FAILED' }) }
    try {
      for (const category of recordWhere(data.categories, 'projectVersionId', version.id)) {
        if (category.isDeleted || category.status !== 1) continue
        const notes = scope + ':' + category.id; let noteCount = 0
        for (const note of recordWhere(data.noteInfos, 'categoryId', category.id)) {
          if (note.isDeleted || note.status !== 1) continue
          let primary: BackupData['noteContents'][number] | undefined
          for (const content of recordWhere(data.noteContents, 'noteInfoId', note.id)) {
            if (content.isDeleted || !content.isPrimary) continue
            if (primary || content.status !== 1 || !content.content.trim()) fail()
            primary = content
          }
          const primaryContent = primary ?? fail()
          store.put(notes, { id: note.id, title: note.noteTitle, hash: createHash('sha256').update(primaryContent.content).digest('hex') })
          noteCount++
        }
        if (!noteCount) fail()
        const sorted = notes + ':sorted'
        for (const row of store.rows<Note>(notes).sort((a, b) => byteCompare(a.title, b.title) || byteCompare(a.hash, b.hash))) store.put(sorted, row)
        store.put(scope, { id: category.id, name: category.categoryName, notes: sorted }); categoryCount++
      }
      if (!categoryCount) fail()
      const categories = store.rows<Category>(scope).sort((a, b) => byteCompare(a.name, b.name) || compareStreams(noteJson(store, a.notes), noteJson(store, b.notes)))
      const hash = createHash('sha256').update('{"schema":3,"categories":['); let comma = ''
      for (const category of categories) {
        hash.update(comma + '{"name":' + JSON.stringify(category.name) + ',"notes":')
        for (const fragment of noteJson(store, category.notes)) hash.update(fragment)
        hash.update('}'); comma = ','
      }
      const manifest = canonicalReleaseManifest({ schema: 3, projectName: snapshot.projectName, version: version.version, contentHash: hash.update(']}').digest('hex') })
      if (manifest !== version.releaseManifestJson || releaseManifestHash(manifest) !== version.releaseHash) fail()
    } finally {
      store.statement('DELETE FROM records WHERE collection>=? AND collection<?').run(scope, scope + '\uffff')
    }
  }
}

/** Re-read imported publication content in primary-key pages inside the surrounding restore transaction. */
export async function verifyRestoredPublications(tx: Prisma.TransactionClient, data: BackupData) {
  const store = recordStore(data.projectVersions)
  if (!store) throw new Error('Restore publication validation requires a disk record index')
  const scope = '$restored-' + randomUUID()
  const specs = {
    projectVersions: { delegate: tx.projectVersion, select: { id: true, version: true, publishedAt: true, releaseHash: true, releaseManifestJson: true } },
    categories: { delegate: tx.category, select: { id: true, projectVersionId: true, categoryName: true, status: true, isDeleted: true } },
    noteInfos: { delegate: tx.noteInfo, select: { id: true, categoryId: true, noteTitle: true, status: true, isDeleted: true } },
    noteContents: { delegate: tx.noteContent, select: { id: true, noteInfoId: true, content: true, isPrimary: true, status: true, isDeleted: true } },
  }
  try {
    for (const [key, spec] of Object.entries(specs)) {
      let after = 0
      while (true) {
        const rows = await (spec.delegate as unknown as { findMany(input: object): Promise<Record<string, unknown>[]> }).findMany({ where: { id: { gt: after } }, orderBy: { id: 'asc' }, take: 100, select: spec.select })
        if (!rows.length) break
        for (const row of rows) {
          after = Number(row.id)
          const portable = Object.fromEntries(Object.entries(row).map(([field, value]) => [field, typeof value === 'number' && (field === 'id' || field.endsWith('Id')) ? String(value) : value]))
          store.put(scope + key, portable as { id: string })
        }
      }
    }
    verifyBackupPublications({ ...data, ...Object.fromEntries(Object.keys(specs).map(key => [key, store.rows(scope + key)])) })
  } finally { store.statement('DELETE FROM records WHERE collection>=? AND collection<?').run(scope, scope + '\uffff') }
}
