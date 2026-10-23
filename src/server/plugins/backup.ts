/**
 * @file backup.ts
 * @project SlothVault
 * @module Portable Plugin Backup and Restore
 * @description Exports owned tables without plugin code and coordinates portable staging-table restores with the core commit receipt.
 * @logic Validate ownership, remap declared core IDs, stage schema before transactions, then reconcile table switches idempotently after committed restores.
 * @dependencies plugin descriptors/SQL bridge, Prisma, existing restore receipt and maintenance gate
 * @index_tags plugins,backup,restore,staging,portability
 * @author holic512
 */
import 'server-only'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile, open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { assertPortableTableGraph, pluginIdSchema, pluginManifestSchema, tableSchema, type PluginTable } from '@slothvault/plugin-sdk/protocol'
import { backupSet, recordIndex, recordWhere } from '@/server/services/admin-backup/record-store'
import { prisma } from '@/server/prisma'
import { HttpError } from '@/server/http/errors'
import { setBackupRecoveryError } from '@/server/services/admin-backup/recovery-state'
import { RESTORE_COMMIT_CONFIG_KEY } from '@/server/services/admin-backup/constants'
import { pluginRoot } from './packages'
import { createOwnedTable, dropOwnedTables, insertPortableRow, orderedPluginTables, physicalTableName, quoteIdentifier, readOwnedRows, resetPluginSequence, schemaDatabase, tableExists, type PluginTransaction } from './database'
import { pluginRegistry } from './state'
import { stopPluginWorker } from './runtime'
const id = z.string().regex(/^[1-9]\d*$/), date = z.string().datetime({ offset: true })
export const pluginBackupShape = {
  pluginInstallations: z.array(z.object({ id, pluginId: pluginIdSchema, version: z.string().max(128), digest: z.string().regex(/^[a-f0-9]{64}$/), manifestJson: z.string().max(512000), configCiphertext: z.string().max(128000), accessBindingsJson: z.string().max(128000).default('{}'), installed: z.boolean(), enabled: z.boolean(), generation: z.number().int().nonnegative(), source: z.string().max(255).nullable(), error: z.string().max(255).nullable(), createdAt: date, updatedAt: date }).strict()).default([]),
  pluginTables: z.array(z.object({ id, pluginId: pluginIdSchema, name: z.string().max(63), descriptorJson: z.string().max(128000) }).strict()).default([]),
  pluginMigrations: z.array(z.object({ id, pluginId: pluginIdSchema, key: z.string().max(128), digest: z.string().regex(/^[a-f0-9]{64}$/), createdAt: date }).strict()).default([]),
  pluginPointReceipts: z.array(z.object({ id, pluginId: pluginIdSchema, sourceKey: z.string().max(255), userId: id.nullable(), amount: z.number().int().positive().max(1000000), balanceAfter: z.number().int().nonnegative(), createdAt: date }).strict()).default([]),
  pluginRows: z.array(z.object({ id, pluginId: pluginIdSchema, tableName: z.string().max(63), rowJson: z.string().max(16 * 1024 * 1024) }).strict()).default([]),
}
export const PLUGIN_BACKUP_KEYS = Object.keys(pluginBackupShape) as (keyof typeof pluginBackupShape)[]
export type PluginBackupData = { [K in keyof typeof pluginBackupShape]: z.infer<(typeof pluginBackupShape)[K]> }
export const pluginBackupDelegates: Record<string, string> = { pluginInstallations: 'pluginInstallation', pluginTables: 'pluginOwnedTable', pluginMigrations: 'pluginMigration', pluginPointReceipts: 'pluginPointReceipt' }
export async function* exportPluginRows(tx: PluginTransaction) {
  let index = 0
  for (const table of await tx.pluginOwnedTable.findMany({ orderBy: { id: 'asc' } })) {
    const descriptor = tableSchema.parse(JSON.parse(table.descriptorJson))
    for await (const row of readOwnedRows(tx, table.name, descriptor)) yield { id: String(++index), pluginId: table.pluginId, tableName: table.name, rowJson: JSON.stringify(row) }
  }
}
export function validatePluginBackup(data: PluginBackupData & Record<string, unknown>) {
  const coreIndexes = new Map<string, Map<string, { id: string }>>()
  const core = (name: string) => {
    if (!coreIndexes.has(name)) coreIndexes.set(name, recordIndex((data[name] as { id: string }[] | undefined) ?? []))
    return coreIndexes.get(name)!
  }
  const manifests = new Map<string, ReturnType<typeof pluginManifestSchema.parse>>()
  for (const record of data.pluginInstallations) {
    const manifest = pluginManifestSchema.parse(JSON.parse(record.manifestJson))
    const bindings = z.record(z.string().regex(/^[1-9]\d*$/), z.number().int().positive()).parse(JSON.parse(record.accessBindingsJson))
    for (const access of [...manifest.api.map(a => a.access), ...manifest.ui.map(a => a.access)]) if (access.audience === 'memberships') for (const id of access.membershipLevelIds) if (!core('membershipLevels').has(String(bindings[String(id)] ?? id))) throw new HttpError('Plugin membership binding target is missing', 400)
    if (manifest.id !== record.pluginId || manifest.version !== record.version || (record.enabled && !record.installed) || manifests.has(record.pluginId)) throw new HttpError('Invalid plugin backup installation', 400)
    manifests.set(record.pluginId, manifest)
  }
  const descriptors = new Map<string, PluginTable>(), owners = new Map<string, string>()
  for (const table of data.pluginTables) {
    const descriptor = tableSchema.parse(JSON.parse(table.descriptorJson))
    const declared = manifests.get(table.pluginId)?.tables.find(t => t.name === descriptor.name)
    if (!declared || JSON.stringify(declared) !== JSON.stringify(descriptor) || physicalTableName(table.pluginId, descriptor) !== table.name || descriptors.has(table.name)) throw new HttpError('Invalid plugin backup table ownership', 400)
    descriptors.set(table.name, descriptor); owners.set(table.name, table.pluginId)
  }
  for (const pluginId of manifests.keys()) assertPortableTableGraph(data.pluginTables.filter(t => t.pluginId === pluginId).map(t => descriptors.get(t.name)!))
  const keys = new Map<string, Set<string>>()
  for (const record of data.pluginRows) {
    const descriptor = descriptors.get(record.tableName)
    if (owners.get(record.tableName) !== record.pluginId || !descriptor) throw new HttpError('Unknown plugin table in backup rows', 400)
    const row = JSON.parse(record.rowJson) as Record<string, unknown>
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== descriptor.columns.length || descriptor.columns.some(c => !Object.hasOwn(row, c.name) || !validPortableValue(c, row[c.name]))) throw new HttpError('Invalid portable plugin row', 400)
    const pk = String(row[descriptor.columns.find(c => c.primary)!.name])
    const tableKeys = keys.get(record.tableName) ?? backupSet(data.pluginRows)
    if (tableKeys.has(pk)) throw new HttpError('Duplicate portable plugin primary key', 400)
    tableKeys.add(pk); keys.set(record.tableName, tableKeys)
  }
  for (const record of data.pluginRows) {
    const descriptor = descriptors.get(record.tableName)!, row = JSON.parse(record.rowJson) as Record<string, unknown>
    for (const col of descriptor.columns) if (col.references && row[col.name] != null) {
      const ref = col.references
      const exists = ref.coreCollection
        ? core(ref.coreCollection).has(String(row[col.name]))
        : keys.get(physicalTableName(record.pluginId, data.pluginTables.filter(t => t.pluginId === record.pluginId).map(t => descriptors.get(t.name)!).find(t => t.name === ref.table)!))?.has(String(row[col.name]))
      if (!exists) throw new HttpError('Plugin backup foreign key target is missing', 400)
    }
  }
  const migrations = backupSet(data.pluginMigrations)
  for (const migration of data.pluginMigrations) {
    const key = `${migration.pluginId}:${migration.key}`
    if (!manifests.has(migration.pluginId) || migrations.has(key)) throw new HttpError('Invalid plugin migration history', 400)
    migrations.add(key)
  }
  const receipts = backupSet(data.pluginPointReceipts)
  for (const receipt of data.pluginPointReceipts) {
    const key = `${receipt.pluginId}:${receipt.sourceKey}`
    if (receipts.has(key) || (receipt.userId && !core('users').has(receipt.userId))) throw new HttpError('Invalid plugin point receipt or user reference', 400)
    receipts.add(key)
  }
}

function validPortableValue(column: PluginTable['columns'][number], value: unknown): boolean {
  if (value === null) return column.nullable
  switch (column.type) {
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647
    case 'bigint': return (typeof value === 'string' && /^-?\d{1,19}$/.test(value) && BigInt(value) >= -9223372036854775808n && BigInt(value) <= 9223372036854775807n) || (typeof value === 'number' && Number.isSafeInteger(value))
    case 'boolean': return typeof value === 'boolean' || value === 0 || value === 1
    case 'datetime': return typeof value === 'string' && Number.isFinite(Date.parse(value))
    case 'binary': return !!value && typeof value === 'object' && Object.keys(value).length === 1 && '$binary' in value && typeof value.$binary === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.$binary)
    case 'json': try { if (typeof value !== 'string') return false; JSON.parse(value); return true } catch { return false }
    case 'string': return typeof value === 'string' && value.length <= (column.length ?? 255)
    case 'text': return typeof value === 'string'
  }
}

type SwitchTable = { pluginId: string; name: string; stage: string; previous: string; descriptor: PluginTable }
type RestoreJournal = { receipt: string; tables: SwitchTable[]; remove: { pluginId?: string; name: string; descriptor: PluginTable }[] }
const journalPath = () => resolve(pluginRoot('slothvault.restore'), 'restore.json')
async function writeJournal(journal: RestoreJournal) { await mkdir(pluginRoot('slothvault.restore'), { recursive: true, mode: 0o700 }); const path = journalPath() + '.tmp'; await writeFile(path, JSON.stringify(journal), { mode: 0o600 }); const file = await open(path, 'r+'); try { await file.sync() } finally { await file.close() }; await rename(path, journalPath()); const directory = await open(pluginRoot('slothvault.restore'), 'r'); try { await directory.sync() } finally { await directory.close() } }
async function readJournal(): Promise<RestoreJournal | null> { try { return JSON.parse(await readFile(journalPath(), 'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error } }
export async function preparePluginRestore(data: PluginBackupData & { giftCards: unknown[]; giftCardBatches: unknown[] }, receipt: string) {
  await reconcilePluginRestore()
  for (const item of pluginRegistry.values()) item.enabled = false
  for (const id of pluginRegistry.keys()) await stopPluginWorker(id)
  const current = (await prisma.pluginOwnedTable.findMany()).map(t => ({ pluginId: t.pluginId, name: t.name, descriptor: tableSchema.parse(JSON.parse(t.descriptorJson)) }))
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10)
  const tables: SwitchTable[] = data.pluginTables.map(t => ({ pluginId: t.pluginId, name: t.name, stage: `svr_${suffix}_${createHash('sha256').update(t.name).digest('hex').slice(0, 20)}`, previous: `svb_${suffix}_${createHash('sha256').update(t.name).digest('hex').slice(0, 20)}`, descriptor: tableSchema.parse(JSON.parse(t.descriptorJson)) }))
  const journal: RestoreJournal = { receipt, tables, remove: current.filter(t => !data.pluginTables.some(target => target.name === t.name)) }
  await writeJournal(journal)
  try {
    for (const pluginId of new Set(tables.map(t => t.pluginId))) {
      const own = tables.filter(t => t.pluginId === pluginId)
      const names = { ...Object.fromEntries(data.pluginTables.filter(t => t.pluginId === pluginId).map(t => [tableSchema.parse(JSON.parse(t.descriptorJson)).name, t.name])), ...Object.fromEntries(own.map(t => [t.descriptor.name, t.stage])) }
      for (const table of orderedPluginTables(own.map(t => ({ pluginId: t.pluginId, name: t.stage, descriptor: t.descriptor })))) {
        const entry = own.find(t => t.stage === table.name)!
        await createOwnedTable(pluginId, entry.descriptor, names, entry.stage)
      }
    }

  } catch (error) { await reconcilePluginRestore(); throw error }
}
export async function clearPluginDataForRestore(tx: PluginTransaction) {
  const tables = (await tx.pluginOwnedTable.findMany()).map(t => ({ pluginId: t.pluginId, name: t.name, descriptor: tableSchema.parse(JSON.parse(t.descriptorJson)) }))
  for (const table of orderedPluginTables(tables).reverse()) if (await tableExists(table.name, tx)) await tx.$executeRawUnsafe(`DELETE FROM ${quoteIdentifier(table.name)}`)
  await tx.pluginTask.deleteMany(); await tx.pluginOperation.deleteMany(); await tx.pluginMigration.deleteMany(); await tx.pluginPointReceipt.deleteMany(); await tx.pluginOwnedTable.deleteMany(); await tx.pluginInstallation.deleteMany(); await tx.pluginPackage.deleteMany()
}
export async function importPluginRecords(tx: PluginTransaction, data: PluginBackupData, coreIds: Record<string, Map<string, number>>) {
  const journal = await readJournal()
  if (data.pluginRows.length && !journal) throw new HttpError('Plugin schema restore must be prepared before the database transaction', 409)
  for (const row of data.pluginInstallations) { const { id, ...record } = row; void id;
    const manifest = pluginManifestSchema.parse(JSON.parse(row.manifestJson)), previous = JSON.parse(row.accessBindingsJson) as Record<string, number>, bindings: Record<string, number> = {}
    for (const access of [...manifest.api.map(a => a.access), ...manifest.ui.map(a => a.access)]) for (const oldId of access.membershipLevelIds) {
      const mapped = coreIds.membershipLevels?.get(String(previous[String(oldId)] ?? oldId))
      if (!mapped) throw new HttpError('Plugin membership binding mapping is missing', 400)
      bindings[String(oldId)] = mapped
    }
    await tx.pluginInstallation.create({ data: { ...record, accessBindingsJson: JSON.stringify(bindings), error: null, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) } }); await tx.pluginPackage.upsert({ where: { digest: row.digest }, create: { pluginId: row.pluginId, digest: row.digest, version: row.version, manifestJson: row.manifestJson }, update: {} }) }
  for (const row of data.pluginTables) { const { id, ...record } = row; void id; await tx.pluginOwnedTable.create({ data: record }) }
  for (const row of data.pluginMigrations) { const { id, ...record } = row; void id; await tx.pluginMigration.create({ data: { ...record, createdAt: new Date(row.createdAt) } }) }
  for (const row of data.pluginPointReceipts) {
    const userId = row.userId ? coreIds.users.get(row.userId) : null; if (row.userId && !userId) throw new HttpError('Plugin point receipt user mapping is missing', 400)
    await tx.pluginPointReceipt.create({ data: { pluginId: row.pluginId, sourceKey: row.sourceKey, userId, amount: row.amount, balanceAfter: row.balanceAfter, createdAt: new Date(row.createdAt) } })
  }
  const descriptors = new Map(data.pluginTables.map(t => [t.name, tableSchema.parse(JSON.parse(t.descriptorJson))]))
  for (const table of orderedPluginTables(data.pluginTables.map(t => ({ ...t, descriptor: descriptors.get(t.name)! })))) for (const record of recordWhere(data.pluginRows, 'tableName', table.name)) {
    const descriptor = descriptors.get(record.tableName)!, row = JSON.parse(record.rowJson) as Record<string, unknown>
    for (const col of descriptor.columns) if (col.references && row[col.name] != null) {
      const ref = col.references
      const collection = ref.coreCollection
      if (collection) {
        const mapped = coreIds[collection]?.get(String(row[col.name]))
        if (!mapped) throw new HttpError('Plugin core-reference mapping is missing', 400)
        row[col.name] = mapped
      }
    }
    const name = journal!.tables.find(t => t.name === record.tableName)!.stage
    await insertPortableRow(tx, name, descriptor, row)
  }
}
export async function reconcilePluginRestore() {
  const journal = await readJournal(); if (!journal) return
  try {
    const receipt = await prisma.systemConfig.findUnique({ where: { configKey: RESTORE_COMMIT_CONFIG_KEY }, select: { configValue: true } })
    if (receipt?.configValue !== journal.receipt) {
      for (const table of orderedPluginTables(journal.tables.map(t => ({ pluginId: t.pluginId, name: t.stage, descriptor: t.descriptor }))).reverse()) if (await tableExists(table.name)) await schemaDatabase().schema.dropTable(table.name).execute()
    } else {
      // Every step is inferable from stable names after a crash; do not rely on transactional DDL.
      for (const table of journal.tables) {
        if (await tableExists(table.stage)) {
          if (await tableExists(table.name) && !await tableExists(table.previous)) await prisma.$executeRawUnsafe(`ALTER TABLE ${quoteIdentifier(table.name)} RENAME TO ${quoteIdentifier(table.previous)}`)
          await prisma.$executeRawUnsafe(`ALTER TABLE ${quoteIdentifier(table.stage)} RENAME TO ${quoteIdentifier(table.name)}`)
        }
      }
      const old = journal.tables.map(t => ({ pluginId: t.pluginId, name: t.previous, descriptor: t.descriptor }))
      await dropOwnedTables([...old, ...journal.remove])
      for (const table of journal.tables) await resetPluginSequence(prisma, table.name, table.descriptor)
    }
    await rm(journalPath(), { force: true }); setBackupRecoveryError(null)
  } catch { setBackupRecoveryError('PLUGIN_RESTORE_REQUIRES_MAINTENANCE'); throw new HttpError('Plugin restore requires maintenance recovery', 503) }
}

/** Validate portable file DTOs and explicit fileId/fileIds references, including JSON columns, without plugin code. */
export function validatePluginFileReferences(
  rows: Iterable<{ pluginId: string; rowJson: string }>,
  lookup: (pluginId: string, id: string) => { id: string; name: string; size: string; sha256: string; createdAt: string } | undefined,
) {
  const missing = (): never => { throw new HttpError('Plugin backup file reference or SHA256 does not match its private file', 400, 400, { reason: 'BACKUP_PLUGIN_FILE_MISMATCH' }) }
  for (const row of rows) {
    const requireFile = (id: string) => lookup(row.pluginId, id) ?? missing()
    const visit = (value: unknown, depth = 0): void => {
      if (depth > 100) throw new HttpError('Plugin backup JSON is too deeply nested', 400)
      if (Array.isArray(value)) { for (const child of value) visit(child, depth + 1); return }
      if (!value || typeof value !== 'object') return
      const record = value as Record<string, unknown>
      if (typeof record.id === 'string' && typeof record.sha256 === 'string' && typeof record.size === 'string' && typeof record.name === 'string') {
        const actual = requireFile(record.id)
        if (actual.sha256 !== record.sha256 || actual.size !== record.size || actual.name !== record.name || (record.createdAt !== undefined && actual.createdAt !== record.createdAt)) missing()
      }
      for (const [key, child] of Object.entries(record)) {
        if (child === null) continue
        if (/(?:^|_)(?:file_id)$/.test(key) || /(?:^fileId$|FileId$)/.test(key)) {
          if (typeof child !== 'string') missing()
          const actual = requireFile(child as string)
          if (typeof record.sha256 === 'string' && actual.sha256 !== record.sha256) missing()
        } else if (key === 'fileIds' || key.endsWith('FileIds') || key === 'file_ids') {
          if (!Array.isArray(child) || child.some(id => typeof id !== 'string')) missing()
          for (const id of child as string[]) requireFile(id)
        }
        if (typeof child === 'string' && /^[\[{]/.test(child.trim())) {
          let parsed: unknown
          try { parsed = JSON.parse(child) } catch { continue }
          visit(parsed, depth + 1)
        } else visit(child, depth + 1)
      }
    }
    visit(JSON.parse(row.rowJson))
  }
}
