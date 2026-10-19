/**
 * @file retirement.ts
 * @project SlothVault
 * @module Preproduction Gift-card Retirement
 * @description Retires legacy card tables without touching core balances, ledger receipts or unrelated plugins.
 * @logic Block foreign ownership/references, drop only fixed historical tables, clear old installation metadata, and journal code cleanup before normal plugin recovery.
 * @dependencies Prisma, database provider, private plugin storage
 * @index_tags plugins,retirement,migration,gift-cards
 * @author holic512
 */
import 'server-only'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '@/server/prisma'
import { configuredDatabaseProvider } from '@/server/database/client'
import { HttpError } from '@/server/http/errors'
import { GIFT_CARDS_PLUGIN_ID } from '@slothvault/plugin-sdk/protocol'
import { pluginRoot } from './packages'
import { quoteIdentifier, tableExists } from './database'
const marker = '__legacy_gift_cards_retired_v1__'
const legacy = ['points_gift_card', 'points_gift_card_batch']
async function historicalPackageDigests() {
  const directory = resolve(pluginRoot(), 'packages')
  const result: string[] = []
  for (const digest of await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error })) {
    if (!/^[a-f0-9]{64}$/.test(digest)) continue
    const file = resolve(directory, digest, 'plugin.json')
    if ((await stat(file)).size > 512000) throw new HttpError('Historical manifest exceeds size limit', 409)
    const manifest = JSON.parse(await readFile(file, 'utf8'))
    if (manifest.id === GIFT_CARDS_PLUGIN_ID) result.push(digest)
  }
  return result
}
export async function retireLegacyGiftCards() {
  const done = await prisma.systemConfig.findUnique({ where: { configKey: marker } })
  if (done?.configValue === 'done') return
  const tables = await prisma.pluginOwnedTable.findMany()
  for (const table of tables) {
    const descriptor = JSON.parse(table.descriptorJson)
    if (table.pluginId !== GIFT_CARDS_PLUGIN_ID && (legacy.includes(table.name) || descriptor.columns?.some((column: { references?: { table: string } }) => legacy.includes(column.references?.table ?? '')))) throw new HttpError('Another plugin references historical gift cards; retirement requires review', 409)
  }
  const provider = configuredDatabaseProvider()
  if (provider === 'sqlite') {
    const existing = await prisma.$queryRawUnsafe<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    for (const table of existing) if (!legacy.includes(table.name)) {
      const escaped = table.name.replaceAll('"', '""')
      const refs = await prisma.$queryRawUnsafe<{ table: string }[]>(`PRAGMA foreign_key_list("${escaped}")`)
      if (refs.some(ref => legacy.includes(ref.table))) throw new HttpError('Historical card table has external references', 409)
    }
  } else {
    const references = await prisma.$queryRawUnsafe<{ source: string; target: string }[]>(provider === 'mysql'
      ? 'SELECT TABLE_NAME AS source, REFERENCED_TABLE_NAME AS target FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL'
      : 'SELECT child.relname AS source, parent.relname AS target FROM pg_constraint fk JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_class parent ON parent.oid=fk.confrelid JOIN pg_namespace ns ON child.relnamespace=ns.oid WHERE fk.contype=\'f\' AND ns.nspname=current_schema()')
    if (references.some(ref => legacy.includes(ref.target) && !legacy.includes(ref.source))) throw new HttpError('Historical card table has external references', 409)
  }
  const old = await prisma.pluginInstallation.findUnique({ where: { pluginId: GIFT_CARDS_PLUGIN_ID } })
  const oldManifest = old ? JSON.parse(old.manifestJson) : null
  const oldInstallation = !!oldManifest?.tables?.some((table: { legacyName?: string }) => table.legacyName)
  const oldPackages = (await prisma.pluginPackage.findMany({ where: { pluginId: GIFT_CARDS_PLUGIN_ID } })).filter(row => JSON.parse(row.manifestJson).tables?.some((table: { legacyName?: string }) => table.legacyName))
  const retireMetadata = oldInstallation || (!old && (oldPackages.length > 0 || tables.some(table => table.pluginId === GIFT_CARDS_PLUGIN_ID && legacy.includes(table.name))))
  const pending = done?.configValue.startsWith('{') ? JSON.parse(done.configValue) as { digests: string[] } : null
  const digests = [...new Set([...(pending?.digests ?? []), ...await historicalPackageDigests(), ...oldPackages.map(row => row.digest)])]
  await prisma.systemConfig.upsert({ where: { configKey: marker }, create: { configKey: marker, configValue: JSON.stringify({ digests }) }, update: { configValue: JSON.stringify({ digests }) } })
  for (const name of legacy) if (await tableExists(name)) await prisma.$executeRawUnsafe(`DROP TABLE ${quoteIdentifier(name)}`)
  if (retireMetadata) {
    await prisma.pluginTask.deleteMany({ where: { pluginId: GIFT_CARDS_PLUGIN_ID } })
    await prisma.pluginOperation.deleteMany({ where: { pluginId: GIFT_CARDS_PLUGIN_ID } })
    await prisma.pluginMigration.deleteMany({ where: { pluginId: GIFT_CARDS_PLUGIN_ID } })
    await prisma.pluginOwnedTable.deleteMany({ where: { pluginId: GIFT_CARDS_PLUGIN_ID } })
    await prisma.pluginPackage.deleteMany({ where: { pluginId: GIFT_CARDS_PLUGIN_ID } })
    await prisma.pluginInstallation.deleteMany({ where: { pluginId: GIFT_CARDS_PLUGIN_ID } })
  }
  for (const digest of digests) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new HttpError('Invalid historical package identity', 409)
    await rm(resolve(pluginRoot(), 'packages', digest), { recursive: true, force: true })
    await rm(resolve(pluginRoot(), 'archives', digest + '.zip'), { force: true })
  }
  const snapshots = resolve(pluginRoot(), 'snapshots')
  for (const name of await readdir(snapshots).catch(error => { if (error.code === 'ENOENT') return []; throw error })) {
    if (!/^[a-f0-9-]+$/.test(name)) continue
    const path = resolve(snapshots, name), snapshot = JSON.parse(await readFile(resolve(path, 'snapshot.json'), 'utf8'))
    if (snapshot.pluginId === GIFT_CARDS_PLUGIN_ID) await rm(path, { recursive: true, force: true })
  }
  await prisma.systemConfig.update({ where: { configKey: marker }, data: { configValue: 'done' } })
}
