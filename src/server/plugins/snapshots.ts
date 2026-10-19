/**
 * @file snapshots.ts
 * @project SlothVault
 * @module Plugin Recovery Snapshots
 * @description Journals plugin-owned schema and paged data without executing plugin recovery callbacks.
 * @logic Write durable descriptors plus NDJSON before DDL, then restore only recorded owned tables and metadata after a failed operation.
 * @dependencies plugin table bridge, Prisma, private app storage
 * @index_tags plugins,recovery,snapshot,migrations
 * @author holic512
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, appendFile, readFile, open } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve, sep } from 'node:path'
import type { PluginManifest, PluginTable } from '@slothvault/plugin-sdk/protocol'
import { tableSchema } from '@slothvault/plugin-sdk/protocol'
import { prisma } from '@/server/prisma'
import { HttpError } from '@/server/http/errors'
import { pluginRoot } from './packages'
import { createOwnedTable, dropOwnedTables, insertPortableRow, orderedPluginTables, physicalTableName, readOwnedRows, resetPluginSequence, tableExists } from './database'
export async function ownedTables(pluginId: string) {
  const tables = await prisma.pluginOwnedTable.findMany({ where: { pluginId }, orderBy: { id: 'asc' } })
  return tables.map(t => ({ name: t.name, descriptor: tableSchema.parse(JSON.parse(t.descriptorJson)) }))
}
export async function snapshotPlugin(pluginId: string, next?: PluginManifest) {
  const directory = resolve(pluginRoot(pluginId), 'snapshots', randomUUID()); await mkdir(directory, { recursive: true, mode: 0o700 })
  const tables = await ownedTables(pluginId)
  for (const descriptor of next?.tables ?? []) {
    const name = physicalTableName(pluginId, descriptor)
    if (!tables.some(t => t.name === name) && await tableExists(name)) tables.push({ name, descriptor })
  }
  const installation = await prisma.pluginInstallation.findUnique({ where: { pluginId } })
  const migrations = await prisma.pluginMigration.findMany({ where: { pluginId } })
  await writeFile(resolve(directory, 'snapshot.json'), JSON.stringify({ pluginId, installation, migrations, tables }), { mode: 0o600 })
  for (const table of tables) {
    const path = resolve(directory, `${table.name}.ndjson`); await writeFile(path, '', { mode: 0o600 }); let lines: string[] = []
    for await (const row of readOwnedRows(prisma, table.name, table.descriptor)) { lines.push(JSON.stringify(row)); if (lines.length === 100) { await appendFile(path, lines.join('\n') + '\n'); lines = [] } }
    if (lines.length) await appendFile(path, lines.join('\n') + '\n')
    const file = await open(path, 'r+'); try { await file.sync() } finally { await file.close() }
  }
  for (const path of [resolve(directory, 'snapshot.json'), directory]) { const file = await open(/* turbopackIgnore: true */ path, 'r'); try { await file.sync() } finally { await file.close() } }
  return directory
}
export async function readSnapshot(directory: string) {
  if (directory !== resolve(directory) || !directory.startsWith(pluginRoot() + sep) || !directory.includes(sep + 'snapshots' + sep)) throw new HttpError('Invalid plugin recovery path', 400)
  const saved = JSON.parse(await readFile(resolve(directory, 'snapshot.json'), 'utf8')) as { pluginId: string; installation: Record<string, unknown> | null; migrations: { key: string; digest: string; createdAt: string }[]; tables: { name: string; descriptor: PluginTable }[] }
  if (!directory.startsWith(resolve(pluginRoot(saved.pluginId), 'snapshots') + sep)) throw new HttpError('Snapshot owner does not match storage path', 400)
  return saved
}
export async function restorePluginSnapshot(directory: string, additional: { name: string; descriptor: PluginTable }[] = []) {
  const saved = await readSnapshot(directory)
  const current = await ownedTables(saved.pluginId)
  const all = [...saved.tables, ...additional, ...current].filter((t, i, list) => list.findIndex(x => x.name === t.name) === i)
  await dropOwnedTables(all)
  const names = Object.fromEntries(saved.tables.map(t => [t.descriptor.name, t.name]))
  for (const table of orderedPluginTables(saved.tables)) {
    await createOwnedTable(saved.pluginId, table.descriptor, names, table.name)
    for await (const line of createInterface({ input: createReadStream(resolve(directory, `${table.name}.ndjson`)), crlfDelay: Infinity })) if (line) await insertPortableRow(prisma, table.name, table.descriptor, JSON.parse(line))
    await resetPluginSequence(prisma, table.name, table.descriptor)
  }
  await prisma.pluginOwnedTable.deleteMany({ where: { pluginId: saved.pluginId } })
  for (const table of saved.tables) await prisma.pluginOwnedTable.create({ data: { pluginId: saved.pluginId, name: table.name, descriptorJson: JSON.stringify(table.descriptor) } })
  await prisma.pluginMigration.deleteMany({ where: { pluginId: saved.pluginId } })
  for (const migration of saved.migrations) await prisma.pluginMigration.create({ data: { pluginId: saved.pluginId, key: migration.key, digest: migration.digest, createdAt: new Date(migration.createdAt) } })
  if (saved.installation) {
    const { id, createdAt, updatedAt, ...data } = saved.installation; void id
    const values = { ...data, createdAt: new Date(String(createdAt)), updatedAt: new Date(String(updatedAt)) } as Parameters<typeof prisma.pluginInstallation.create>[0]['data']
    await prisma.pluginInstallation.upsert({ where: { pluginId: saved.pluginId }, create: values, update: values })
  } else await prisma.pluginInstallation.deleteMany({ where: { pluginId: saved.pluginId } })
}
