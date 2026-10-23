/**
 * @file database-export.ts
 * @project SlothVault
 * @module Portable Database Snapshot
 * @description Writes current business collections as paged, validated NDJSON snapshots.
 * @logic Read one repeatable snapshot in primary-key pages, convert provider scalars, and persist rows and integrity metadata without loading the whole database. Include registered plugin tables without executing their code and retain legacy card collections.
 * @dependencies Prisma unit-of-work, backup record schemas, private disk record store, Node streams, plugin backup descriptors
 * @index_tags backup,database,ndjson,pagination,snapshot
 * @author holic512
 */
import 'server-only'
import { exportPluginRows, pluginBackupDelegates } from '@/server/plugins/backup'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { z } from 'zod'
import { readNoteTags } from '@/lib/note-tags'
import { databaseSnapshotIsolationLevel } from '@/server/database/client'
import { unitOfWork } from '@/server/database/unit-of-work'
import { toJsonSafe } from '@/server/http/response'
import { HttpError } from '@/server/http/errors'
import type { BackupEntryDigest, BackupProgress } from '@/types/backup'
import { ACTIVE_BACKUP_COLLECTION_KEYS, DATABASE_BACKUP_VERSION, DATABASE_TRANSACTION_MAX_WAIT_MS, DATABASE_TRANSACTION_TIMEOUT_MS, DEPRECATED_CONFIG_KEYS, RESTORE_COMMIT_CONFIG_KEY } from './constants'
import { backupDataSchema, type BackupData, type DatabaseImportPayload } from './database-schema'
import { verifyBackupPublications } from './publication-validation'
import { validateBackupRelations } from './database-validation'
import { RecordStore } from './record-store'

export const collectionDelegates: Record<string, string> = {
  ...pluginBackupDelegates,
  users: 'user', userWallets: 'userWallet', userDeletionRecords: 'userDeletionRecord', pointTransactions: 'pointTransaction', membershipLevels: 'membershipLevel', membershipGrants: 'membershipGrant', articles: 'article', projects: 'project', projectVersions: 'projectVersion', categories: 'category', projectMenus: 'projectMenu', projectHomes: 'projectHome', noteInfos: 'noteInfo', noteContents: 'noteContent', fileManagements: 'fileManagement', fileReferences: 'fileReference', systemConfigs: 'systemConfig', systemHomepages: 'systemHomepage', releaseCredentials: 'releaseCredential', releaseCredentialAttempts: 'releaseCredentialAttempt',
}
export function backupRowSchema(key: string): z.ZodType {
  let schema: z.ZodType = backupDataSchema.shape[key as keyof typeof backupDataSchema.shape]
  while (schema && !(schema instanceof z.ZodArray) && 'unwrap' in schema) schema = (schema as z.ZodDefault<z.ZodType>).unwrap()
  if (!(schema instanceof z.ZodArray)) throw new HttpError('Unknown backup collection', 400, 400)
  return schema.element as z.ZodType
}
export function parseBackupRow(key: string, value: unknown): { id: string } {
  if (!value || typeof value !== 'object') throw new HttpError('Invalid backup record', 400, 400)
  const row = value as Record<string, unknown>
  const required = key === 'projects' ? ['readAccessMode','downloadAccessMode','readMembershipLevelIds','downloadMembershipLevelIds'] : key === 'articles' ? ['allowedMembershipLevelIds'] : []
  if (required.some(field => !Object.hasOwn(row, field) || row[field] === undefined)) throw new HttpError('Incomplete backup access policy', 400, 400)
  return backupRowSchema(key).parse(value) as { id: string }
}
function portableRow(key: string, input: Record<string, unknown>) {
  const row = { ...input }
  for (const [field, value] of Object.entries(row)) {
    if (typeof value === 'number' && (field === 'id' || field.endsWith('Id'))) row[field] = String(value)
  }
  delete row.documentRevision; delete row.contentRevision
  if (key === 'noteInfos') { row.tags = readNoteTags(row.tagsJson as string | null); delete row.tagsJson }
  const links = (field: string) => (row[field] as { membershipLevelId: number }[] ?? []).map(link => String(link.membershipLevelId))
  if (key === 'articles') { row.allowedMembershipLevelIds = links('allowedMemberships'); delete row.allowedMemberships }
  if (key === 'projects') { row.readMembershipLevelIds = links('readMemberships'); row.downloadMembershipLevelIds = links('downloadMemberships'); delete row.readMemberships; delete row.downloadMemberships }
  return parseBackupRow(key, toJsonSafe(row))
}
export function storedPayload(store: RecordStore): DatabaseImportPayload {
  const data = Object.fromEntries(Object.keys(backupDataSchema.shape).map(key => [key, store.rows(key)])) as BackupData
  return { version: DATABASE_BACKUP_VERSION, mode: 'overwrite', data }
}
export async function exportDatabaseSnapshot(directory: string, store: RecordStore, progress?: (value: Partial<BackupProgress>) => Promise<void>) {
  const exportedAt = new Date().toISOString(), counts: Record<string, number> = {}, database: Record<string, BackupEntryDigest> = {}
  await mkdir(resolve(directory, 'database'), { recursive: true, mode: 0o700 })
  let processedRecords = 0
  await unitOfWork.execute(async tx => {
    type Delegate = { findMany(input: object): Promise<Record<string, unknown>[]> }
    for (const key of ACTIVE_BACKUP_COLLECTION_KEYS) {
      const handle = await open(resolve(directory, 'database', `${key}.ndjson`), 'wx', 0o600)
      const hash = createHash('sha256'); let bytes = 0, count = 0, after = 0
      try {
        if (key === 'pluginRows') {
          for await (const row of exportPluginRows(tx)) {
            const value = parseBackupRow(key, row), line = Buffer.from(JSON.stringify(value) + '\n')
            store.put(key, value); await handle.writeFile(line); hash.update(line); bytes += line.length; count++; processedRecords++
          }
        } else while (true) {
          const where: Record<string, unknown> = { id: { gt: after } }
          if (key === 'systemConfigs') where.configKey = { notIn: [RESTORE_COMMIT_CONFIG_KEY, ...DEPRECATED_CONFIG_KEYS] }
          if (key === 'releaseCredentials') { where.subjectType = 'PROJECT_VERSION'; where.subjectManifestVersion = 3 }
          if (key === 'releaseCredentialAttempts') where.credential = { subjectType: 'PROJECT_VERSION', subjectManifestVersion: 3 }
          const include = key === 'articles' ? { allowedMemberships: true } : key === 'projects' ? { readMemberships: true, downloadMemberships: true } : undefined
          const rows = await (tx as unknown as Record<string, Delegate>)[collectionDelegates[key]].findMany({ where, orderBy: { id: 'asc' }, take: 100, ...(include ? { include } : {}) })
          if (!rows.length) break
          for (const row of rows) {
            after = Number(row.id)
            const value = portableRow(key, row), line = Buffer.from(JSON.stringify(value) + '\n')
            store.put(key, value); await handle.writeFile(line); hash.update(line); bytes += line.length; count++; processedRecords++
          }
          await progress?.({ processedRecords })
        }
        await handle.sync()
      } finally { await handle.close() }
      counts[key] = count; database[key] = { size: bytes, sha256: hash.digest('hex') }
    }
  }, { isolationLevel: databaseSnapshotIsolationLevel(), maxWait: DATABASE_TRANSACTION_MAX_WAIT_MS, timeout: DATABASE_TRANSACTION_TIMEOUT_MS, mode: 'read' })
  const payload = storedPayload(store)
  validateBackupRelations(payload.data); verifyBackupPublications(payload.data)
  return { exportedAt, counts, database }
}
/** Small-data service adapter for internal diagnostics; production backups use exportDatabaseSnapshot. */
export async function exportDatabaseBackup() {
  const directory = await mkdtemp(resolve(tmpdir(), 'sv-database-snapshot-')), store = new RecordStore(resolve(directory, 'index.sqlite'))
  try {
    const result = await exportDatabaseSnapshot(directory, store)
    const data = Object.fromEntries(ACTIVE_BACKUP_COLLECTION_KEYS.map(key => [key, Array.from(store.iterate(key))])) as BackupData
    return { version: DATABASE_BACKUP_VERSION, exportedAt: result.exportedAt, data }
  } finally { store.close(); await rm(directory, { recursive: true, force: true }) }
}
