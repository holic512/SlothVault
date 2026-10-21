import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import mariadb from 'mariadb'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient as PgClient } from '../../../generated/prisma-postgresql/client'
import { PrismaClient as MySQLClient } from '../../../generated/prisma-mysql/client'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient as SQLiteClient } from '../../../generated/prisma-sqlite/client'
import type { PrismaClient } from '../../../generated/prisma-postgresql/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ client: undefined as PrismaClient | undefined, directory: '', provider: 'sqlite' as 'sqlite' | 'mysql' | 'postgresql' }))
vi.mock('@/server/prisma', () => ({ get prisma() { return mocks.client } }))
vi.mock('@/server/database/client', () => ({ getDatabaseClient: () => mocks.client, configuredDatabaseProvider: () => mocks.provider, databaseSnapshotIsolationLevel: () => 'Serializable' }))
vi.mock('@/server/config/app-data', () => ({ appDataPath: () => mocks.directory }))
vi.mock('@/server/config/master-key', () => ({ getMasterKey: () => 'plugin-test-master-key-not-a-production-credential' }))
import { initializePlugins, invokePluginService, listPlugins, uninstallPlugin, installPlugin, resetPluginInitialization, setPluginEnabled, savePluginConfig, invokeRegisteredPlugin, rollbackPlugin } from './manager'
import { pluginWorkers, startPluginWorker, stopPluginWorker } from './runtime'
import { pluginRegistry } from './state'
import { editTestPackage } from './test-package'
import { enqueuePluginEvent } from './events'
import { tickPluginTasks } from './scheduler'
import { clearPluginDataForRestore, exportPluginRows, importPluginRecords, pluginBackupShape, preparePluginRestore, reconcilePluginRestore, validatePluginBackup, type PluginBackupData } from './backup'
import { RESTORE_COMMIT_CONFIG_KEY } from '@/server/services/admin-backup/constants'
import { tableExists, pluginTableMap, quoteIdentifier, placeholder, PluginTransactions } from './database'
import { toJsonSafe } from '@/server/http/response'
import { z } from 'zod'
import { acquireMaintenanceLock } from '@/server/services/maintenance-lock'
import { boundPluginAccess } from './access'

const cases = [
  { provider: 'sqlite' as const, url: '' },
  { provider: 'postgresql' as const, url: process.env.SLOTHVAULT_PLUGIN_TEST_POSTGRESQL_URL },
  { provider: 'mysql' as const, url: process.env.SLOTHVAULT_PLUGIN_TEST_MYSQL_URL },
]
// Each case may compile source packages and restart workers several times. The
// unit-test default (5s) can expire during cold compilation on CI, leaving an
// unfinished lifecycle operation racing the next fixture's database setup.
for (const testCase of cases) describe.skipIf(testCase.provider !== 'sqlite' && !testCase.url)(`plugin integration / ${testCase.provider}`, { timeout: 30_000 }, () => {
  let cleanup: (() => Promise<void>) | undefined
  beforeEach(async () => {
    mocks.provider = testCase.provider
    mocks.directory = mkdtempSync(join(tmpdir(), 'sv-plugin-integration-'))
    const migrations = readdirSync(resolve(`prisma/providers/${testCase.provider}/migrations`)).filter(n => /^\d/.test(n)).sort().map(name => readFileSync(resolve(`prisma/providers/${testCase.provider}/migrations`, name, 'migration.sql'), 'utf8'))
    if (testCase.provider === 'sqlite') {
      const file = join(mocks.directory, 'test.db'), db = new Database(file)
      db.pragma('foreign_keys = ON'); for (const sql of migrations) db.exec(sql); db.close()
      mocks.client = new SQLiteClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }, { timestampFormat: 'iso8601' }) }) as unknown as PrismaClient
    } else {
      const url = new URL(testCase.url!)
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Integration fixtures require a dedicated local test server')
      const name = `sv_plugin_test_${randomBytes(8).toString('hex')}`
      if (testCase.provider === 'postgresql') {
        const admin = new Pool({ connectionString: url.toString() })
        await admin.query(`CREATE DATABASE "${name}"`)
        url.pathname = `/${name}`
        const setup = new Pool({ connectionString: url.toString() })
        try { for (const sql of migrations) await setup.query(sql) } finally { await setup.end() }
        mocks.client = new PgClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 10 }) })
        cleanup = async () => { await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end() }
      } else {
        const config = { host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), multipleStatements: true, allowPublicKeyRetrieval: true }
        const admin = await mariadb.createConnection(config)
        await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
        const setup = await mariadb.createConnection({ ...config, database: name })
        try { for (const sql of migrations) await setup.query(sql) } finally { await setup.end() }
        mocks.client = new MySQLClient({ adapter: new PrismaMariaDb({ ...config, database: name, connectionLimit: 10 }) }) as unknown as PrismaClient
        cleanup = async () => { await admin.query(`DROP DATABASE \`${name}\``); await admin.end() }
      }
    }
    resetPluginInitialization()
    await initializePlugins()
    expect(pluginRegistry.has('slothvault.gift-cards')).toBe(false)
    expect(await tableExists('points_gift_card')).toBe(false)
    await installPlugin(readFileSync('dist/plugins/gift-cards/slothvault-plugin-slothvault.gift-cards-1.1.0.zip'), { trusted: true, actorUserId: null })
    expect(pluginRegistry.get('slothvault.gift-cards')?.enabled).toBe(false)
    await setPluginEnabled('slothvault.gift-cards', true, 1)
  }, 60000)
  afterEach(async () => { for (const id of pluginWorkers.keys()) await stopPluginWorker(id); resetPluginInitialization(); await mocks.client?.$disconnect(); await cleanup?.(); cleanup = undefined; rmSync(mocks.directory, { recursive: true, force: true }) }, 60_000)
  it('manually installs owned tables, redeems atomically, and keeps the core ledger after data-purging uninstall', async () => {
    const admin = await mocks.client!.user.create({ data: { username: 'admin', password: 'test', role: 'ADMIN' } })
    const user = await mocks.client!.user.create({ data: { username: 'reader', password: 'test' } })
    await initializePlugins()
    expect(pluginRegistry.get('slothvault.gift-cards')?.enabled).toBe(true)
    const activated = await Promise.all(Array.from({ length: 4 }, () => startPluginWorker(pluginRegistry.get('slothvault.gift-cards')!)))
    expect(new Set(activated).size).toBe(1)
    const issued = await invokePluginService('slothvault.gift-cards', 'issue', { actor: { userId: admin.id, role: 'ADMIN' }, input: { name: 'Welcome', points: 40, quantity: 1 } }) as { codes: string[] }
    const result = await invokePluginService('slothvault.gift-cards', 'redeem', { actor: { userId: user.id, role: 'USER' }, input: { code: issued.codes[0] } })
    expect(result).toMatchObject({ pointsAdded: 40, pointsBalance: 40 })
    expect(await invokePluginService('slothvault.gift-cards', 'stats', { actor: { userId: admin.id, role: 'ADMIN' } })).toMatchObject({ total: 1, redeemed: 1 })
    await expect(invokePluginService('slothvault.gift-cards', 'stats', { actor: { userId: user.id, role: 'USER' } })).rejects.toThrow('Unauthorized')
    await expect(invokePluginService('slothvault.gift-cards', 'redeem', { actor: { userId: user.id, role: 'USER' }, input: { code: issued.codes[0] } })).rejects.toThrow('already redeemed')
    await setPluginEnabled('slothvault.gift-cards', false, admin.id)
    await expect(invokePluginService('slothvault.gift-cards', 'list', { actor: { userId: admin.id, role: 'ADMIN' } })).rejects.toThrow('disabled')
    await uninstallPlugin('slothvault.gift-cards', { deleteData: true, confirmPluginId: 'slothvault.gift-cards', actorUserId: admin.id })
    expect((await mocks.client!.user.findUniqueOrThrow({ where: { id: user.id } })).pointsBalance).toBe(40)
    expect(await mocks.client!.pointTransaction.count()).toBe(1)
    resetPluginInitialization(); await initializePlugins()
    expect((await listPlugins())[0].installed).toBe(false)
    await installPlugin(readFileSync('dist/plugins/gift-cards/slothvault-plugin-slothvault.gift-cards-1.1.0.zip'), { trusted: true, actorUserId: admin.id })
    await setPluginEnabled('slothvault.gift-cards', true, admin.id)
    expect(await tableExists(pluginTableMap(pluginRegistry.get('slothvault.gift-cards')!.manifest).cards)).toBe(true)
    expect(await invokePluginService('slothvault.gift-cards', 'list', { actor: { userId: admin.id, role: 'ADMIN' } })).toMatchObject({ total: 0 })
  })
  it('preserves card data across uninstall and reinstall', async () => {
    const admin = await mocks.client!.user.create({ data: { username: 'admin', password: 'test', role: 'ADMIN' } })
    await initializePlugins()
    await invokePluginService('slothvault.gift-cards', 'issue', { actor: { userId: admin.id, role: 'ADMIN' }, input: { name: 'Retained', points: 20, quantity: 2 } })
    await uninstallPlugin('slothvault.gift-cards', { deleteData: false, actorUserId: admin.id })
    await installPlugin(readFileSync('dist/plugins/gift-cards/slothvault-plugin-slothvault.gift-cards-1.1.0.zip'), { trusted: true, actorUserId: admin.id })
    await setPluginEnabled('slothvault.gift-cards', true, admin.id)
    expect(await invokePluginService('slothvault.gift-cards', 'list', { actor: { userId: admin.id, role: 'ADMIN' } })).toMatchObject({ total: 1, list: [{ name: 'Retained', quantity: 2 }] })
  })

  it('rolls card consumption back when the core credit fails and rejects concurrent duplicate redemption', async () => {
    const admin = await mocks.client!.user.create({ data: { username: 'admin', password: 'test', role: 'ADMIN' } })
    const user = await mocks.client!.user.create({ data: { username: 'reader', password: 'test', pointsBalance: 2147483640 } })
    await initializePlugins()
    const actor = { userId: user.id, role: 'USER' }, input = { actor: { userId: admin.id, role: 'ADMIN' }, input: { name: 'Atomic', points: 40, quantity: 1 } }
    const issued = await invokePluginService('slothvault.gift-cards', 'issue', input) as { codes: string[] }
    const redeem = () => invokePluginService('slothvault.gift-cards', 'redeem', { actor, input: { code: issued.codes[0] } })
    await expect(redeem()).rejects.toThrow('balance limit')
    expect(await mocks.client!.pointTransaction.count()).toBe(0)
    expect(await mocks.client!.pluginPointReceipt.count()).toBe(0)
    await mocks.client!.user.update({ where: { id: user.id }, data: { pointsBalance: 0 } })
    const results = await Promise.allSettled([redeem(), redeem()])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await mocks.client!.pointTransaction.count()).toBe(1)
    expect((await mocks.client!.user.findUniqueOrThrow({ where: { id: user.id } })).pointsBalance).toBe(40)
  })
  it('restores schema, data and the old version after a broken independent upgrade', async () => {
    const admin = await mocks.client!.user.create({ data: { username: 'admin', password: 'test', role: 'ADMIN' } })
    await initializePlugins()
    await invokePluginService('slothvault.gift-cards', 'issue', { actor: { userId: admin.id, role: 'ADMIN' }, input: { name: 'Before upgrade', points: 20, quantity: 1 } })
    const broken = await editTestPackage(readFileSync('dist/plugins/gift-cards/slothvault-plugin-slothvault.gift-cards-1.1.0.zip'), files => {
      const manifest = JSON.parse(files.get('plugin.json')!.toString()); manifest.version = '1.1.1'
      files.set('plugin.json', Buffer.from(JSON.stringify(manifest)))
      files.set('src/server.ts', Buffer.from('throw new Error("TEST_BROKEN_UPGRADE")'))
    })
    await expect(installPlugin(broken, { trusted: true, actorUserId: admin.id })).rejects.toThrow('activation failed')
    expect((await listPlugins())[0]).toMatchObject({ version: '1.1.0', enabled: true })
    expect(await invokePluginService('slothvault.gift-cards', 'list', { actor: { userId: admin.id, role: 'ADMIN' } })).toMatchObject({ total: 1 })
    expect((await mocks.client!.pluginOperation.findFirstOrThrow({ where: { action: 'UPDATE' } })).status).toBe('FAILED')
  })
  it('does not restore the same upgrade snapshot twice and erase post-rollback data', async () => {
    await initializePlugins()
    const update = await editTestPackage(readFileSync('dist/plugins/gift-cards/slothvault-plugin-slothvault.gift-cards-1.1.0.zip'), files => {
      const manifest = JSON.parse(files.get('plugin.json')!.toString())
      manifest.version = '1.1.1'
      files.set('plugin.json', Buffer.from(JSON.stringify(manifest)))
    })
    await installPlugin(update, { trusted: true, actorUserId: null })
    await rollbackPlugin('slothvault.gift-cards', 1)
    expect(pluginRegistry.get('slothvault.gift-cards')?.manifest.version).toBe('1.1.0')
    await expect(rollbackPlugin('slothvault.gift-cards', 1)).rejects.toThrow('matching upgrade snapshot')
    expect(await mocks.client!.pluginOperation.count({ where: { action: 'ROLLBACK' } })).toBe(1)
  })

  it('recovers actual table data after a migration performs DDL and then fails', async () => {
    await initializePlugins()
    const original = readFileSync('dist/plugins/example/slothvault-plugin-slothvault.example-1.0.0.zip')
    await installPlugin(original, { trusted: true, actorUserId: null })
    await setPluginEnabled('slothvault.example', true, 1)
    await enqueuePluginEvent(mocks.client!, 'core.article.published', { id: 1 }); await tickPluginTasks()
    const update = await editTestPackage(original, files => {
      const manifest = JSON.parse(files.get('plugin.json')!.toString()); manifest.version = '1.1.1'; manifest.migrations.push('partial-ddl')
      manifest.tables[0].columns.push({ name: 'partial', type: 'text', nullable: true })
      files.set('plugin.json', Buffer.from(JSON.stringify(manifest)))
      files.set('src/server.ts', Buffer.from(`export default ctx => ({ api: { status: async () => ({}) }, events: { 'core.article.published': async () => {}, 'core.project-version.published': async () => {} }, jobs: { tick: async () => {} }, migrations: { initial: async () => {}, 'partial-ddl': async () => { await ctx.db.schema.alterTable(ctx.table('counters')).addColumn('partial', 'text').execute(); throw new Error('AFTER_DDL_FAILURE') } } })`))
    })
    await expect(installPlugin(update, { trusted: true, actorUserId: null })).rejects.toThrow('AFTER_DDL_FAILURE')
    const item = pluginRegistry.get('slothvault.example')!
    expect(item.manifest.version).toBe('1.0.0')
    expect(await invokeRegisteredPlugin(item, 'api', 'status', { actor: null })).toMatchObject({ counters: [{ id: 'articles', value: 1 }] })
  })
  it('does not bypass an unfinished recovery through enable, configure, repair or rollback', async () => {
    await initializePlugins()
    const id = 'slothvault.gift-cards'
    const bytes = readFileSync('dist/plugins/gift-cards/slothvault-plugin-slothvault.gift-cards-1.1.0.zip')
    for (const error of ['PLUGIN_RECOVERY_REQUIRED', 'PLUGIN_UNINSTALL_INCOMPLETE']) {
      await mocks.client!.pluginInstallation.update({ where: { pluginId: id }, data: { enabled: false, error } })
      pluginRegistry.get(id)!.enabled = false
      for (const operation of [
        () => setPluginEnabled(id, true, 1),
        () => setPluginEnabled(id, false, 1),
        () => savePluginConfig(id, { maxBatchQuantity: 100 }),
        () => installPlugin(bytes, { trusted: true, actorUserId: null }),
        () => rollbackPlugin(id, 1),
      ]) await expect(operation()).rejects.toMatchObject({ status: 409, data: { reason: error } })
      expect((await mocks.client!.pluginInstallation.findUniqueOrThrow({ where: { pluginId: id } })).error).toBe(error)
      expect(pluginWorkers.has(id)).toBe(false)
    }
  })

  it('rejects enabled upgrades whose new dependency is disabled before changing tables', async () => {
    await initializePlugins()
    await installPlugin(readFileSync('dist/plugins/example/slothvault-plugin-slothvault.example-1.0.0.zip'), { trusted: true, actorUserId: null })
    const update = await editTestPackage(readFileSync('dist/plugins/gift-cards/slothvault-plugin-slothvault.gift-cards-1.1.0.zip'), files => {
      const manifest = JSON.parse(files.get('plugin.json')!.toString())
      manifest.version = '1.1.1'
      manifest.dependencies = { 'slothvault.example': '^1.0.0' }
      files.set('plugin.json', Buffer.from(JSON.stringify(manifest)))
    })
    await expect(installPlugin(update, { trusted: true, actorUserId: null })).rejects.toThrow('dependency')
    expect(pluginRegistry.get('slothvault.gift-cards')).toMatchObject({ enabled: true, manifest: { version: '1.1.0' } })
    expect(await mocks.client!.pluginOperation.count({ where: { action: 'UPDATE' } })).toBe(0)
  })

  it('requires the active transaction for point credits rather than committing outside it', async () => {
    const user = await mocks.client!.user.create({ data: { username: 'credit-reader', password: 'test' } })
    await initializePlugins()
    const worker = await startPluginWorker(pluginRegistry.get('slothvault.gift-cards')!)
    // Exercise the host boundary directly so this guard cannot be bypassed by SDK callers.
    const transactions = new PluginTransactions()
    const transactionId = await transactions.begin()
    const post = vi.spyOn(worker.worker, 'postMessage')
    worker.pending.set('credit-guard', {
      resolve: () => undefined, reject: () => undefined, timer: setTimeout(() => undefined, 10_000),
      scope: { actor: { userId: user.id, role: 'USER' }, transactions, ddl: false, readOnly: false, background: false, active: true, hosts: new Set() },
    })
    try {
      await worker.host({ id: 1, invocationId: 'credit-guard', method: 'points.credit', payload: { userId: user.id, amount: 5, sourceKey: 'missing-tx', description: 'test' } })
      expect(post).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ status: 409 }) }))
      await transactions.end(transactionId, false)
      expect(await mocks.client!.pluginPointReceipt.count()).toBe(0)
      expect((await mocks.client!.user.findUniqueOrThrow({ where: { id: user.id } })).pointsBalance).toBe(0)
    } finally {
      clearTimeout(worker.pending.get('credit-guard')!.timer)
      worker.pending.delete('credit-guard')
      await transactions.abortAll()
      post.mockRestore()
    }
  })

  it('runs declared hooks/jobs asynchronously and cancels pending work on disable', async () => {
    await initializePlugins()
    await installPlugin(readFileSync('dist/plugins/example/slothvault-plugin-slothvault.example-1.0.0.zip'), { trusted: true, actorUserId: null })
    expect(pluginRegistry.get('slothvault.example')?.enabled).toBe(false)
    expect(pluginWorkers.has('slothvault.example')).toBe(false)
    expect(await enqueuePluginEvent(mocks.client!, 'core.article.published', { id: 1 })).toBeUndefined()
    expect(await mocks.client!.pluginTask.count()).toBe(0)
    await setPluginEnabled('slothvault.example', true, 1)
    await savePluginConfig('slothvault.example', { message: 'Configured' })
    await expect(savePluginConfig('slothvault.example', { message: '' })).rejects.toThrow()
    await enqueuePluginEvent(mocks.client!, 'core.article.published', { id: 1 })
    await tickPluginTasks()
    const item = pluginRegistry.get('slothvault.example')!
    const response = await invokeRegisteredPlugin(item, 'api', 'status', { actor: null })
    expect(response).toMatchObject({ message: 'Configured', counters: [{ id: 'articles', value: 1 }] })
    const completed = await mocks.client!.pluginTask.findFirstOrThrow({ where: { kind: 'event' } })
    await mocks.client!.pluginTask.update({ where: { id: completed.id }, data: { status: 'PENDING', runAt: new Date(0) } })
    await tickPluginTasks()
    expect(await invokeRegisteredPlugin(item, 'api', 'status', { actor: null })).toMatchObject({ counters: [{ id: 'articles', value: 1 }] })
    await mocks.client!.pluginTask.updateMany({ where: { kind: 'job' }, data: { runAt: new Date(0) } })
    await tickPluginTasks()
    expect(await invokeRegisteredPlugin(item, 'api', 'status', { actor: null })).toMatchObject({ counters: expect.arrayContaining([{ id: 'ticks', value: 1 }]) })
    await enqueuePluginEvent(mocks.client!, 'core.article.published', { id: 2 })
    const release = await acquireMaintenanceLock('exclusive')
    const pending = invokeRegisteredPlugin(item, 'jobs', 'tick', undefined, true).then(() => 'completed', () => 'canceled')
    await vi.waitFor(() => expect([...pluginWorkers.get('slothvault.example')!.pending.values()].some(value => value.scope.hosts.size > 0)).toBe(true))
    try { await setPluginEnabled('slothvault.example', false, 1) } finally { release() }
    expect(await pending).toBe('canceled')
    await new Promise(resolve => setTimeout(resolve, 20))
    const counters = await mocks.client!.$queryRawUnsafe<{ value: number }[]>(`SELECT value FROM ${quoteIdentifier(pluginTableMap(item.manifest).counters)} WHERE id='ticks'`)
    expect(counters[0].value).toBe(1)
    expect(await mocks.client!.pluginTask.count({ where: { status: 'PENDING' } })).toBe(0)
    expect(pluginWorkers.has('slothvault.example')).toBe(false)
  })
  it('restores owned tables without plugin code and remaps declared core IDs', async () => {
    await initializePlugins()
    const level = await mocks.client!.membershipLevel.create({ data: { name: 'Old member', rank: 1, pricePoints: 10 } })
    const owner = await mocks.client!.user.create({ data: { username: 'oldowner', password: 'test' } })
    const bytes = await editTestPackage(readFileSync('dist/plugins/example/slothvault-plugin-slothvault.example-1.0.0.zip'), files => {
      const manifest = JSON.parse(files.get('plugin.json')!.toString())
      manifest.ui.find((ui: { surface: string; kind: string }) => ui.surface === 'public' && ui.kind === 'page').access = { audience: 'memberships', membershipLevelIds: [level.id] }
      manifest.tables.push({ name: 'references', columns: [{ name: 'id', type: 'integer', generated: true, primary: true }, { name: 'owner_id', type: 'integer', nullable: true, references: { table: 'auth_user', column: 'id', onDelete: 'SET NULL', coreCollection: 'users' } }, { name: 'counter_id', type: 'string', length: 100, references: { table: 'counters', column: 'id', onDelete: 'CASCADE' } }] })
      for (const suffix of ['a', 'b']) manifest.tables.push({ name: `very_long_plugin_table_shared_prefix_${suffix}`, columns: [{ name: 'id', type: 'integer', primary: true, generated: true }, { name: 'counter_id', type: 'string', length: 100, references: { table: 'counters', column: 'id', onDelete: 'CASCADE' } }], indexes: [{ columns: ['counter_id'] }] })
      files.set('plugin.json', Buffer.from(JSON.stringify(manifest)))
    })
    await installPlugin(bytes, { trusted: true, actorUserId: null })
    await setPluginEnabled('slothvault.example', true, 1)
    await enqueuePluginEvent(mocks.client!, 'core.article.published', { id: 1 }); await tickPluginTasks()
    const names = pluginTableMap(pluginRegistry.get('slothvault.example')!.manifest)
    await mocks.client!.$executeRawUnsafe(`INSERT INTO ${quoteIdentifier(names.references)} (owner_id,counter_id) VALUES (${placeholder(1)},${placeholder(2)})`, owner.id, 'articles')
    const rows = []; for await (const row of exportPluginRows(mocks.client!)) rows.push(row)
    const data = z.object(pluginBackupShape).parse(toJsonSafe({ pluginInstallations: (await mocks.client!.pluginInstallation.findMany()).map(r => ({ ...r, id: String(r.id) })), pluginTables: (await mocks.client!.pluginOwnedTable.findMany()).map(r => ({ ...r, id: String(r.id) })), pluginMigrations: (await mocks.client!.pluginMigration.findMany()).map(r => ({ ...r, id: String(r.id) })), pluginPointReceipts: [], pluginRows: rows })) as PluginBackupData
    validatePluginBackup({ ...data, users: [{ id: String(owner.id) }], membershipLevels: [{ id: String(level.id) }] })
    await uninstallPlugin('slothvault.example', { actorUserId: 1, deleteData: true, confirmPluginId: 'slothvault.example' })
    const receipt = 'test-plugin-restore'
    await preparePluginRestore({ ...data, giftCards: [], giftCardBatches: [] }, receipt)
    const newOwner = await mocks.client!.user.create({ data: { username: 'newowner', password: 'test' } })
    const newLevel = await mocks.client!.membershipLevel.create({ data: { name: 'Restored member', rank: 2, pricePoints: 10 } })
    await mocks.client!.$transaction(async tx => {
      await clearPluginDataForRestore(tx)
      await importPluginRecords(tx, data, { users: new Map([[String(owner.id), newOwner.id]]), membershipLevels: new Map([[String(level.id), newLevel.id]]) })
      await tx.systemConfig.create({ data: { configKey: RESTORE_COMMIT_CONFIG_KEY, configValue: receipt } })
    })
    await reconcilePluginRestore()
    const restored = await mocks.client!.$queryRawUnsafe<{ owner_id: number }[]>(`SELECT owner_id FROM ${quoteIdentifier(names.references)}`)
    expect(restored[0].owner_id).toBe(newOwner.id)
    await mocks.client!.$executeRawUnsafe(`INSERT INTO ${quoteIdentifier(names.references)} (owner_id,counter_id) VALUES (${placeholder(1)},${placeholder(2)})`, newOwner.id, 'articles')
    expect(await tableExists(names.counters)).toBe(true)
    resetPluginInitialization(); await initializePlugins()
    expect((await listPlugins()).find(item => item.id === 'slothvault.example')?.codeState).toBe('MISSING')
    expect(boundPluginAccess(pluginRegistry.get('slothvault.example')!, { audience: 'memberships', membershipLevelIds: [level.id] }).membershipLevelIds).toEqual([newLevel.id])
    await expect(invokeRegisteredPlugin(pluginRegistry.get('slothvault.example')!, 'api', 'status', { actor: null })).rejects.toThrow()
    await installPlugin(bytes, { trusted: true, actorUserId: null })
    expect(await invokeRegisteredPlugin(pluginRegistry.get('slothvault.example')!, 'api', 'status', { actor: null })).toMatchObject({ counters: [{ id: 'articles', value: 1 }] })
  })
  it('restores plaintext cards and their owned batch references without special legacy collections', async () => {
    const admin = await mocks.client!.user.create({ data: { username: 'admin', password: 'test', role: 'ADMIN' } })
    await initializePlugins()
    const issue = (name: string) => invokePluginService('slothvault.gift-cards', 'issue', { actor: { userId: admin.id, role: 'ADMIN' }, input: { name, points: 10, quantity: 1 } }) as Promise<{ batch: { id: string } }>
    const first = await issue('Original batch')
    const update = await editTestPackage(readFileSync('dist/plugins/gift-cards/slothvault-plugin-slothvault.gift-cards-1.1.0.zip'), files => {
      const manifest = JSON.parse(files.get('plugin.json')!.toString()); manifest.version = '1.1.1'
      manifest.tables.push({ name: 'annotations', columns: [{ name: 'id', type: 'integer', primary: true, generated: true }, { name: 'batch_id', type: 'integer', references: { table: 'batches', column: 'id', onDelete: 'CASCADE' } }] })
      files.set('plugin.json', Buffer.from(JSON.stringify(manifest)))
    })
    await installPlugin(update, { trusted: true, actorUserId: admin.id })
    const name = pluginTableMap(pluginRegistry.get('slothvault.gift-cards')!.manifest).annotations
    await mocks.client!.$executeRawUnsafe(`INSERT INTO ${quoteIdentifier(name)} (batch_id) VALUES (${placeholder(1)})`, Number(first.batch.id))
    const rows = []; for await (const row of exportPluginRows(mocks.client!)) rows.push(row)
    const stringifyIds = (rows: { id: number }[]) => rows.map(row => ({ ...row, id: String(row.id) }))
    const data = z.object(pluginBackupShape).parse(toJsonSafe({ pluginInstallations: stringifyIds(await mocks.client!.pluginInstallation.findMany()), pluginTables: stringifyIds(await mocks.client!.pluginOwnedTable.findMany()), pluginMigrations: stringifyIds(await mocks.client!.pluginMigration.findMany()), pluginRows: rows }))
    validatePluginBackup({ ...data, giftCardBatches: [{ id: first.batch.id }], giftCards: [], users: [{ id: String(admin.id) }] })
    await issue('Later batch'); const receipt = 'owned-table-restore'
    await preparePluginRestore({ ...data, giftCardBatches: [{ id: first.batch.id }], giftCards: [] }, receipt)
    await mocks.client!.$transaction(async tx => {
      await clearPluginDataForRestore(tx)
      await importPluginRecords(tx, data, { users: new Map([[String(admin.id), admin.id]]) })
      await tx.systemConfig.create({ data: { configKey: RESTORE_COMMIT_CONFIG_KEY, configValue: receipt } })
    })
    await reconcilePluginRestore()
    const restored = await mocks.client!.$queryRawUnsafe<{ batch_id: number }[]>(`SELECT batch_id FROM ${quoteIdentifier(name)}`)
    expect(restored[0].batch_id).toBe(Number(first.batch.id))
  })

})
