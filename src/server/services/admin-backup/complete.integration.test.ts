import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient as SQLiteClient } from '@generated/prisma-sqlite/client'
import { PrismaClient as MySQLClient } from '@generated/prisma-mysql/client'
import { PrismaClient as PostgreSQLClient } from '@generated/prisma-postgresql/client'
import type { AppPrismaClient } from '@/server/database/client'
import { NextRequest } from 'next/server'
import unzipper from 'unzipper'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupManifest, BackupSnapshot } from '@/types/backup'

const fixture = vi.hoisted(() => ({
  root: `/tmp/sv-complete-tests-${process.pid}-${Date.now()}`,
  client: null as unknown as AppPrismaClient,
  provider: process.env.SLOTHVAULT_BACKUP_TEST_PROVIDER ?? 'sqlite',
  failure: null as 'switch' | 'cleanup' | 'space' | null,
  health: 'INSTALLED',
  after: [] as Array<() => Promise<void>>,
  articleCache: vi.fn(),
  projectCache: vi.fn(),
}))
vi.mock('@/server/database/client', () => ({ getDatabaseClient: () => fixture.client, configuredDatabaseProvider: () => fixture.provider, databaseSnapshotIsolationLevel: () => fixture.provider === 'sqlite' ? 'Serializable' : 'RepeatableRead' }))
vi.mock('@/server/prisma', () => ({ get prisma() { return fixture.client } }))
vi.mock('@/server/services/admin-files', async (load) => ({ ...await load<typeof import('@/server/services/admin-files')>(), UPLOAD_ROOT: fixture.root + '/uploads' }))
vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: async () => ({ status: fixture.health }), isDatabaseConnectivityError: () => false }))
vi.mock('@/server/services/public-article-cache', () => ({ invalidatePublicArticleCache: fixture.articleCache }))
vi.mock('@/server/services/public-project-cache', () => ({ invalidatePublicProjectCache: fixture.projectCache }))
vi.mock('next/server', async (load) => ({ ...await load<typeof import('next/server')>(), after: (callback: () => Promise<void>) => { fixture.after.push(callback) } }))
vi.mock('node:fs/promises', async (load) => {
  const actual = await load<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (source: string, destination: string) => {
      if (fixture.failure === 'switch' && source.includes('/.complete-restore-') && !destination.includes('/.complete-')) {
        fixture.failure = null
        throw Object.assign(new Error('injected file switch failure'), { code: 'EIO' })
      }
      return actual.rename(source, destination)
    },
    rm: async (path: string, options: Parameters<typeof actual.rm>[1]) => {
      if (fixture.failure === 'cleanup' && path.includes('/.complete-rollback-')) throw Object.assign(new Error('injected cleanup failure'), { code: 'EIO' })
      return actual.rm(path, options)
    },
    statfs: async (path: string, options: Parameters<typeof actual.statfs>[1]) => fixture.failure === 'space' ? { bavail: 0n, bsize: 4096n } : actual.statfs(path, options),
  }
})

import { issueSession, readSessionToken } from '@/server/auth/session'
import { acquireMaintenanceLock } from '@/server/services/maintenance-lock'
import { exportDatabaseBackup } from './database-export'
import * as importer from './database-import'
import { parseDatabaseImportPayload } from './database-validation'
import { createCompleteSnapshot, readCompleteBundle, sha256File } from './archive'
import { assertBackupIdle, backupHistory, deleteBackupSnapshot, getBackupJob, previewCompleteRestore, queueCompleteBackup, queueCompleteRestore, runCompleteBackup, runCompleteRestore, uploadCompleteBackup } from './complete'
import { artifactPath, atomicJson, backupStatePath, backupStoragePath, DEFAULT_BACKUP_SETTINGS, ensureBackupStorage, pinSnapshot, readSettings, recordPath, releaseBackupJob, sourceIsPinned, storageStatus } from './store'
import { prepareRestoreJournal, readRestoreJournal, reconcileRestoreJournal, recoverPendingRestore, restoreJournalPath, switchRestoreFiles } from './recovery'
import { backupRecoveryError, setBackupRecoveryError } from './recovery-state'
import { initializeBackupRuntime, nextBackupRun, saveBackupSettings, scheduledSlot, tickBackupScheduler } from './scheduler'
import { COMPLETE_BACKUP_MAX_BYTES, RESTORE_COMMIT_CONFIG_KEY, ZIP_ENTRY_MAX_BYTES, ZIP_FILE_MAX_BYTES } from './constants'
import { collectFilesExportEntries } from './files-export'
import { extractZipToStaging } from './files-import'
import { updateCrc32, validateZipArchive, validateZipFile } from './zip-validation'
import { rebuildFileReferences } from '@/server/services/file-references'
import { publishProjectVersion } from '@/server/services/project-version-release'
import { createCommission, getCommission } from '@/server/commissions/service'
import { createCommissionDocument } from '@/server/commissions/documents'
import { listContractTemplates } from '@/server/commissions/templates'
import { completeAgreementValues } from '@/server/commissions/test-fixtures'
import { issueAdminContract, signUserContract } from '@/server/services/contracts'
import { uploadCommissionFile } from '@/server/commissions/files'
import { GET as settingsGet, PUT as settingsPut } from '@/app/api/admin/mm/backup/settings/route'
import { GET as historyGet, POST as snapshotPost } from '@/app/api/admin/mm/backup/snapshots/route'
import { GET as jobGet } from '@/app/api/admin/mm/backup/jobs/[id]/route'
import { GET as downloadGet } from '@/app/api/admin/mm/backup/snapshots/[id]/download/route'
import { DELETE as snapshotDelete } from '@/app/api/admin/mm/backup/snapshots/[id]/route'
import { POST as uploadPost } from '@/app/api/admin/mm/backup/imports/route'
import { POST as previewPost } from '@/app/api/admin/mm/backup/restores/preview/route'
import { POST as restorePost } from '@/app/api/admin/mm/backup/restores/route'
import { POST as legacyImportPost } from '@/app/api/admin/mm/backup/database-import/route'
import { POST as legacyFilesPost } from '@/app/api/admin/mm/backup/files-import/route'
import { POST as resetPost } from '@/app/api/admin/mm/backup/system-reset/route'

const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')
const uploads = () => resolve(fixture.root, 'uploads')
const deletedAt = new Date('2026-09-01T12:00:00.000Z')
function storedZip(entries: Array<{ name: string; content: Buffer; declaredSize?: number }>) {
  const locals: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name), crc = (updateCrc32(0xffffffff, entry.content) ^ 0xffffffff) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(entry.content.length, 18); local.writeUInt32LE(entry.declaredSize ?? entry.content.length, 22); local.writeUInt16LE(name.length, 26)
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8)
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(entry.content.length, 20); record.writeUInt32LE(entry.declaredSize ?? entry.content.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42)
    locals.push(local, name, entry.content); central.push(record, name); offset += local.length + name.length + entry.content.length
  }
  const end = Buffer.alloc(22), records = Buffer.concat(central)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(records.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, records, end])
}
type Exported = Awaited<ReturnType<typeof exportDatabaseBackup>>
async function editedBundle(snapshot: BackupSnapshot, edit: (database: Exported, manifest: BackupManifest, entries: Map<string, Buffer>) => void) {
  const archive = await unzipper.Open.file(artifactPath(snapshot.id))
  const entries = new Map<string, Buffer>()
  for (const entry of archive.files) entries.set(entry.path, await entry.buffer())
  const database = JSON.parse(entries.get('database.json')!.toString()) as Exported
  const manifest = JSON.parse(entries.get('manifest.json')!.toString()) as BackupManifest
  edit(database, manifest, entries)
  const data = Buffer.from(JSON.stringify(database))
  manifest.databaseVersion = database.version
  manifest.counts = Object.fromEntries(Object.entries(database.data).map(([key, rows]) => [key, rows.length]))
  manifest.databaseSha256 = digest(data); manifest.filesSha256 = digest(entries.get('files.zip')!)
  entries.set('database.json', data); entries.set('manifest.json', Buffer.from(JSON.stringify(manifest)))
  return storedZip([...entries].map(([name, content]) => ({ name, content })))
}
async function uploaded(bytes: Buffer, adminId: number) {
  return uploadCompleteBackup(new Request('http://localhost/import', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: new Uint8Array(bytes) }), adminId)
}
function request(path: string, options: { token?: string; method?: string; body?: unknown } = {}) {
  return new NextRequest(`http://localhost/api/admin/mm/backup/${path}`, { method: options.method ?? 'GET', headers: { ...(options.token ? { Cookie: `sv_session=${options.token}` } : {}), 'Content-Type': 'application/json' }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) })
}
const context = (id: string) => ({ params: Promise.resolve({ id }) })
let client: AppPrismaClient
let clientReady = false
let sqlDatabase: string | null = null
function sqlContainer() {
  const id = process.env.SLOTHVAULT_BACKUP_TEST_CONTAINER ?? ''
  if (!/^[a-f0-9]{64}$/.test(id) || !['mysql', 'postgresql'].includes(fixture.provider)) throw new Error('An isolated backup test container is required')
  const inspect = spawnSync('docker', ['inspect', id], { encoding: 'utf8' })
  if (inspect.status !== 0) throw new Error('Cannot inspect backup test container')
  const container = JSON.parse(inspect.stdout)[0]
  const binding = container.NetworkSettings.Ports[fixture.provider === 'mysql' ? '3306/tcp' : '5432/tcp']?.[0]
  if (container.Config.Labels['slothvault.test'] !== 'backup' || binding?.HostIp !== '127.0.0.1') throw new Error('Only a labeled, isolated loopback test container is allowed')
  return { id, port: Number(binding.HostPort) }
}
function containerSql(id: string, database: string | null, sql: string) {
  const command = fixture.provider === 'mysql' ? ['mysql', '--user=root', ...(database ? [database] : [])] : ['psql', '--username=postgres', '--set=ON_ERROR_STOP=1', '--dbname=' + (database ?? 'postgres')]
  const result = spawnSync('docker', ['exec', '-i', id, ...command], { input: sql, encoding: 'utf8', maxBuffer: 1024 * 1024 })
  if (result.status !== 0) throw new Error(`Isolated database setup failed: ${result.stderr.slice(-2000)}`)
}
beforeEach(async () => {
  clientReady = false
  process.env.APP_DATA_PATH = fixture.root
  delete process.env.BACKUP_STORAGE_PATH
  fixture.failure = null; fixture.health = 'INSTALLED'; fixture.after = []
  setBackupRecoveryError(null); vi.clearAllMocks()
  mkdirSync(uploads(), { recursive: true })
  if (fixture.provider === 'sqlite') {
    const file = resolve(fixture.root, 'test.sqlite'), db = new Database(file)
    db.pragma('foreign_keys = ON')
    for (const name of readdirSync('prisma/providers/sqlite/migrations').filter((name) => /^\d/.test(name)).sort()) db.exec(readFileSync(`prisma/providers/sqlite/migrations/${name}/migration.sql`, 'utf8'))
    db.close()
    client = fixture.client = new SQLiteClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }, { timestampFormat: 'iso8601' }) }) as unknown as AppPrismaClient
  } else {
    const container = sqlContainer()
    sqlDatabase = `sv_backup_${process.pid}_${randomUUID().replaceAll('-', '')}`
    containerSql(container.id, null, `CREATE DATABASE ${sqlDatabase}${fixture.provider === 'mysql' ? ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci' : ''};`)
    const migrations = `prisma/providers/${fixture.provider}/migrations`
    const sql = readdirSync(migrations).filter((name) => /^\d/.test(name)).sort().map((name) => {
      const migration = readFileSync(`${migrations}/${name}/migration.sql`, 'utf8')
      // This existing MySQL migration drops an index that backs a foreign key.
      // Supply the equivalent ordinary index in the disposable fixture without editing deployed migration history.
      return fixture.provider === 'mysql' && name === '20260820000000_note_content_evidence'
        ? migration.replace('DROP INDEX `uq_release_credential_version_network`', 'CREATE INDEX `idx_backup_fixture_release_version` ON `release_credential`(`project_version_id`);\nDROP INDEX `uq_release_credential_version_network`')
        : migration
    }).join('\n')
    containerSql(container.id, sqlDatabase, sql)
    client = fixture.client = (fixture.provider === 'mysql'
      ? new MySQLClient({ adapter: new PrismaMariaDb({ host: '127.0.0.1', port: container.port, user: 'root', database: sqlDatabase, timezone: 'Z' }, { database: sqlDatabase }) })
      : new PostgreSQLClient({ adapter: new PrismaPg({ host: '127.0.0.1', port: container.port, user: 'postgres', database: sqlDatabase }) })) as unknown as AppPrismaClient
  }
  clientReady = true
})
afterEach(async () => {
  fixture.failure = null
  const runtime = (globalThis as unknown as { slothVaultBackupScheduler?: { timer?: ReturnType<typeof setInterval>; initialized?: Promise<void>; ticking: boolean } }).slothVaultBackupScheduler
  if (runtime) { if (runtime.timer) clearInterval(runtime.timer); runtime.timer = undefined; runtime.initialized = undefined; runtime.ticking = false }
  const history = await backupHistory()
  if (history.activeJob) releaseBackupJob(history.activeJob.id)
  setBackupRecoveryError(null); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs()
  if (clientReady) await client.$disconnect()
  await fs.rm(fixture.root, { recursive: true, force: true })
  if (sqlDatabase) { containerSql(sqlContainer().id, null, `DROP DATABASE ${sqlDatabase};`); sqlDatabase = null }
  delete process.env.APP_DATA_PATH; delete process.env.BACKUP_STORAGE_PATH
})

async function seed() {
  const admin = await client.user.create({ data: { username: 'admin', password: 'backup-admin-hash', email: 'backup-admin@example.invalid', pointsBalance: 15, role: 'ADMIN', displayName: 'Backup administrator' } })
  const user = await client.user.create({ data: { username: 'member', password: 'backup-member-hash', pointsBalance: 100, email: 'member@example.invalid', walletAddress: '1'.repeat(32) } })
  const level = await client.membershipLevel.create({ data: { name: 'Member', rank: 1, pricePoints: 10, validityDays: 30 } })
  await client.membershipGrant.create({ data: { userId: user.id, membershipLevelId: level.id, source: 'ADMIN_GRANT', grantedByUserId: admin.id } })
  await client.pointTransaction.create({ data: { userId: user.id, amount: 100, balanceAfter: 100, type: 'ADMIN_GRANT' } })
  await fs.mkdir(resolve(uploads(), 'other'), { recursive: true })
  await fs.writeFile(resolve(uploads(), 'other/proof.txt'), 'data')
  const file = await client.fileManagement.create({ data: { originalName: 'proof.txt', fileName: 'proof.txt', filePath: 'uploads/other/proof.txt', fileSize: 4n, businessType: 'Other', status: 0 } })
  const project = await client.project.create({ data: { projectName: 'Protected', weight: 0, status: 1, readAccessMode: 'MEMBERSHIPS', readMemberships: { create: { membershipLevelId: level.id } }, downloadAccessMode: 'DISABLED' } })
  const version = await client.projectVersion.create({ data: { projectId: project.id, version: '1.0', status: 0, weight: 0 } })
  const category = await client.category.create({ data: { projectVersionId: version.id, categoryName: 'Guide', weight: 0, status: 1 } })
  const note = await client.noteInfo.create({ data: { categoryId: category.id, noteTitle: 'Evidence', weight: 0, status: 1 } })
  await client.noteContent.create({ data: { noteInfoId: note.id, content: '# Frozen bytes\n', status: 1, isPrimary: true, evidenceId: randomUUID() } })
  const release = await publishProjectVersion(version.id)
  const trash = await client.projectVersion.create({ data: { projectId: project.id, version: 'trash', status: 0, weight: 1, isDeleted: true, deletedAt } })
  const deletedCategory = await client.category.create({ data: { projectVersionId: trash.id, categoryName: 'Deleted', weight: 0, status: 0, isDeleted: true, deletedAt } })
  const deletedNote = await client.noteInfo.create({ data: { categoryId: deletedCategory.id, noteTitle: 'Deleted note', weight: 0, status: 0, isDeleted: true, deletedAt } })
  await client.noteContent.create({ data: { noteInfoId: deletedNote.id, content: '[proof](/uploads/other/proof.txt)', status: 0, isDeleted: true, deletedAt } })
  await client.article.create({ data: { title: 'Deleted article', content: 'Stored trash', status: 0, isDeleted: true, deletedAt, allowedMemberships: { create: { membershipLevelId: level.id } } } })
  const menu = await client.projectMenu.create({ data: { projectId: project.id, label: 'Deleted menu', weight: 0, status: 0, isDeleted: true, deletedAt } })
  await client.projectMenu.create({ data: { projectId: project.id, parentId: menu.id, label: 'Deleted child', weight: 0, status: 0, isDeleted: true, deletedAt } })
  await client.$transaction((tx) => rebuildFileReferences(tx))
  const session = await issueSession({ userId: admin.id })
  const otherSession = await issueSession({ userId: user.id })
  await client.mcpApiKey.create({ data: { userId: user.id, publicId: randomUUID().replaceAll('-', ''), secretHash: 'test-only', name: 'old-key' } })
  await client.systemInstallation.create({ data: { id: 1, provider: fixture.provider, status: 'INSTALLED', schemaRevision: 10, installationId: randomUUID() } })
  return { admin, user, file, release, session, otherSession }
}
async function snapshot() { return createCompleteSnapshot('manual', randomUUID(), async () => undefined) }
async function staged() {
  await ensureBackupStorage()
  const id = randomUUID(), stage = resolve(uploads(), `.complete-input-${id}/uploads`)
  await fs.mkdir(resolve(stage, 'other'), { recursive: true }); await fs.writeFile(resolve(stage, 'other/proof.txt'), 'next')
  return { id, stage, journal: await prepareRestoreJournal(id, stage) }
}

describe(`complete backups with isolated ${fixture.provider} and uploads`, () => {
  it('restores trash, disabled files, policies, points, signed contracts and releases while preserving current administrator credentials', async () => {
    const s = await seed()
    const actor = { userId: s.admin.id, isAdmin: true, sessionId: s.session.sessionId }
    let commission = await createCommission({ userId: s.user.id, isAdmin: false }, { commandId: randomUUID(), title: 'Restore evidence', purpose: 'Backup', requirements: 'Preserve signed snapshots' })
    const template = (await listContractTemplates())[0].versions.find((version) => version.status === 'PUBLISHED')!
    commission = await createCommissionDocument(Number(commission.id), actor, { commandId: randomUUID(), revision: commission.revision, templateVersionId: Number(template.id), documentType: 'AGREEMENT', values: completeAgreementValues() })
    const document = commission.documents[0]
    await issueAdminContract({ id: Number(document.id), issuerUserId: s.admin.id, sessionId: s.session.sessionId })
    await signUserContract({ id: Number(document.id), userId: s.user.id, sessionId: s.otherSession.sessionId, ip: '127.0.0.1', userAgent: 'backup-test' })
    await uploadCommissionFile(Number(commission.id), actor, new Request('http://localhost/file', { method: 'POST', body: 'frozen commission file' }), { name: 'source.txt', purpose: 'DELIVERY', shared: false, commandId: randomUUID() })
    const before = await exportDatabaseBackup(), complete = await snapshot()
    const preview = await previewCompleteRestore({ snapshotId: complete.id }, s.admin.id)
    expect(preview.manifest.counts.noteContents).toBe(2)
    await client.user.update({ where: { id: s.admin.id }, data: { password: 'current-admin-hash', email: 'current-admin@example.invalid', pointsBalance: 999 } })
    await client.user.update({ where: { id: s.user.id }, data: { password: 'changed-member-hash', pointsBalance: 0 } })
    await client.user.create({ data: { username: 'later', password: 'test' } })
    await fs.writeFile(resolve(uploads(), 'other/proof.txt'), 'live')
    const job = await queueCompleteRestore(preview.id, s.admin.id)
    await runCompleteRestore(job, preview.id, s.session.sessionId)
    expect(job).toMatchObject({ status: 'succeeded', phase: 'complete' })
    expect(job.protectionId).toBeDefined()
    const restored = await exportDatabaseBackup()
    expect(restored.data.noteContents.map((item) => [item.content, item.isDeleted, item.deletedAt])).toEqual(before.data.noteContents.map((item) => [item.content, item.isDeleted, item.deletedAt]))
    expect(restored.data.articles[0]).toMatchObject({ isDeleted: true, deletedAt: deletedAt.toISOString() })
    expect(restored.data.projectMenus).toHaveLength(2)
    expect(restored.data.fileManagements[0].status).toBe(0)
    expect(restored.data.fileReferences).toHaveLength(before.data.fileReferences.length)
    expect(restored.data.projects[0]).toMatchObject({ readAccessMode: 'MEMBERSHIPS', downloadAccessMode: 'DISABLED' })
    expect(restored.data.projectVersions.find((version) => version.releaseId === s.release.releaseId)?.releaseHash).toBe(s.release.releaseHash)
    expect(restored.data.contracts[0]).toMatchObject({ status: 2, bodyHash: before.data.contracts[0].bodyHash, snapshotHash: before.data.contracts[0].snapshotHash })
    const order = await client.commission.findUniqueOrThrow({ where: { commissionId: commission.commissionId } })
    expect((await getCommission(order.id, actor)).documents[0].bodyHash).toBe(document.bodyHash)
    expect(await fs.readFile(resolve(uploads(), 'other/proof.txt'), 'utf8')).toBe('data')
    expect(await client.user.findUniqueOrThrow({ where: { id: s.admin.id } })).toMatchObject({ password: 'current-admin-hash', email: 'current-admin@example.invalid', role: 'ADMIN', pointsBalance: 15 })
    expect(await client.user.findUniqueOrThrow({ where: { username: 'member' } })).toMatchObject({ password: 'backup-member-hash', pointsBalance: 100 })
    expect(await client.user.findUnique({ where: { username: 'later' } })).toBeNull()
    expect(await readSessionToken(s.session.token)).not.toBeNull()
    expect(await readSessionToken(s.otherSession.token)).toBeNull()
    expect((await client.mcpApiKey.findFirstOrThrow()).status).toBe(0)
    expect(restored.data.systemConfigs.some((item) => item.configKey === RESTORE_COMMIT_CONFIG_KEY)).toBe(false)
    expect(await readRestoreJournal()).toBeNull()
    expect((await fs.stat(artifactPath(complete.id))).mode & 0o777).toBe(0o600)
    expect((await fs.stat(backupStoragePath())).mode & 0o777).toBe(0o700)
  })
  it('preserves an administrator absent from the source, resets their balance, and keeps only source accounts otherwise', async () => {
    const s = await seed(), complete = await snapshot()
    const local = await client.user.create({ data: { username: 'new-admin', role: 'ADMIN', password: 'current', email: 'new@example.invalid', pointsBalance: 333 } })
    const session = await issueSession({ userId: local.id }), preview = await previewCompleteRestore({ snapshotId: complete.id }, local.id)
    const job = await queueCompleteRestore(preview.id, local.id); await runCompleteRestore(job, preview.id, session.sessionId)
    expect(job.status).toBe('succeeded')
    expect(await client.user.findUniqueOrThrow({ where: { id: local.id } })).toMatchObject({ password: 'current', role: 'ADMIN', pointsBalance: 0 })
    expect(await client.user.count()).toBe(3); expect(await readSessionToken(session.token)).not.toBeNull()
    expect(await readSessionToken(s.session.token)).toBeNull()
  })
  it('rejects insert-mode user and configuration collisions before any business data changes', async () => {
    await seed()
    await client.systemConfig.create({ data: { configKey: 'test', configValue: 'old' } })
    const backup = await exportDatabaseBackup(), before = await client.project.count()
    await expect(importer.importDatabaseBackup(parseDatabaseImportPayload({ data: backup.data, version: backup.version, mode: 'insert' }))).rejects.toMatchObject({ status: 409 })
    const configOnly = { ...backup, data: { ...backup.data, users: [], pointTransactions: [], membershipGrants: [], systemConfigs: backup.data.systemConfigs, projects: [], projectVersions: [], categories: [], noteInfos: [], noteContents: [], projectMenus: [], articles: [], fileReferences: [] } }
    await expect(importer.importDatabaseBackup(parseDatabaseImportPayload({ data: configOnly.data, version: configOnly.version, mode: 'insert' }))).rejects.toMatchObject({ status: 409 })
    expect(await client.project.count()).toBe(before)
    expect((await client.systemConfig.findUniqueOrThrow({ where: { configKey: 'test' } })).configValue).toBe('old')
  })
  it('rejects credentials that conflict with the protected administrator during preview', async () => {
    const s = await seed(), complete = await snapshot()
    const bytes = await editedBundle(complete, (database) => { database.data.users.find((user) => user.username === 'member')!.email = 'current@example.invalid' })
    await client.user.update({ where: { id: s.admin.id }, data: { email: 'current@example.invalid' } })
    await expect(previewCompleteRestore(await uploaded(bytes, s.admin.id), s.admin.id)).rejects.toMatchObject({ status: 409 })
    expect(await client.article.count()).toBe(1)
  })
  it.skipIf(fixture.provider !== 'mysql').each([
    { field: 'username' as const, value: 'MEMBER' },
    { field: 'username' as const, value: 'mémber' },
    { field: 'username' as const, value: 'member ' },
    { field: 'email' as const, value: 'MEMBER@example.invalid' },
    { field: 'walletAddress' as const, value: '1'.repeat(32) + ' ' },
  ])('rejects internal MySQL collation collisions for $field ($value) during preview', async ({ field, value }) => {
    const s = await seed(), complete = await snapshot()
    const bytes = await editedBundle(complete, (database) => {
      const member = database.data.users.find((user) => user.username === 'member')!
      database.data.users.push({ ...member, id: '999', username: 'another', email: 'another@example.invalid', walletAddress: null, [field]: value })
    })
    await expect(previewCompleteRestore(await uploaded(bytes, s.admin.id), s.admin.id)).rejects.toMatchObject({ status: 409, data: { reason: 'BACKUP_UNIQUE_CONFLICT' } })
    expect(await client.user.count()).toBe(2)
    expect(await fs.readFile(resolve(uploads(), 'other/proof.txt'), 'utf8')).toBe('data')
  })
  it('requires all current-format collections and keeps old-format compatibility warnings', async () => {
    const s = await seed(), complete = await snapshot()
    const missing = await editedBundle(complete, (database) => { Reflect.deleteProperty(database.data, 'commissionEvents') })
    await expect(previewCompleteRestore(await uploaded(missing, s.admin.id), s.admin.id)).rejects.toMatchObject({ status: 400 })
    const old = await editedBundle(complete, (database) => { Reflect.set(database, 'version', '2.9.0'); Reflect.deleteProperty(database.data, 'commissionEvents') })
    const preview = await previewCompleteRestore(await uploaded(old, s.admin.id), s.admin.id)
    expect(preview.warnings).toContain('LEGACY_BACKUP_SCOPE')
    expect(await client.article.count()).toBe(1)
  })
  it('rejects outer checksum tampering and frozen attachment hash mismatches without publishing a backup', async () => {
    const s = await seed(), complete = await snapshot()
    const damaged = await fs.readFile(artifactPath(complete.id))
    damaged[30 + damaged.readUInt16LE(26) + damaged.readUInt16LE(28)] ^= 1
    await expect(previewCompleteRestore(await uploaded(damaged, s.admin.id), s.admin.id)).rejects.toMatchObject({ status: 400 })
    const corrupt = await editedBundle(complete, (_database, manifest) => { manifest.files[0].sha256 = '0'.repeat(64) })
    await expect(previewCompleteRestore(await uploaded(corrupt, s.admin.id), s.admin.id)).rejects.toMatchObject({ status: 400 })
    const actor = { userId: s.admin.id, isAdmin: true }
    const order = await createCommission({ userId: s.user.id, isAdmin: false }, { commandId: randomUUID(), title: 'Frozen', purpose: 'Backup', requirements: 'Verify bytes' })
    await uploadCommissionFile(Number(order.id), actor, new Request('http://localhost/file', { method: 'POST', body: 'frozen' }), { name: 'source.txt', purpose: 'DELIVERY', shared: false, commandId: randomUUID() })
    const metadata = await client.fileManagement.findFirstOrThrow({ where: { businessType: 'CommissionAttachment' } })
    await fs.writeFile(resolve(uploads(), metadata.filePath.slice(8)), 'tamper')
    const job = await queueCompleteBackup(s.admin.id); await runCompleteBackup(job)
    expect(job).toMatchObject({ status: 'failed', error: 'BACKUP_ATTACHMENT_MISMATCH' })
    expect((await backupHistory()).snapshots).toHaveLength(1)
  })
  it.each(['../escape.txt', '/absolute.txt', 'C:drive.txt', '.hidden/file.txt', 'a\\b.txt'])('rejects unsafe archive path %s without changing live files', async (name) => {
    await seed()
    await expect(validateZipArchive(storedZip([{ name, content: Buffer.from('bad') }]))).rejects.toMatchObject({ status: 400 })
    expect(await fs.readFile(resolve(uploads(), 'other/proof.txt'), 'utf8')).toBe('data')
  })
  it('rejects broken ZIP checksums, duplicate entries, entry count, extracted-size limits, and oversized complete uploads', async () => {
    const s = await seed()
    const corrupt = storedZip([{ name: 'other/data.txt', content: Buffer.from('data') }]); corrupt[30 + Buffer.byteLength('other/data.txt')] ^= 1
    const archive = resolve(fixture.root, 'bad.zip'); await fs.writeFile(archive, corrupt)
    const staging = resolve(fixture.root, 'crc-check'); await fs.mkdir(staging)
    await expect(extractZipToStaging(await validateZipArchive(corrupt), staging)).rejects.toMatchObject({ status: 400 })
    await expect(readCompleteBundle(archive, resolve(fixture.root, 'bad'))).rejects.toMatchObject({ status: 400 })
    await expect(validateZipArchive(storedZip([{ name: 'same', content: Buffer.alloc(0) }, { name: 'SAME', content: Buffer.alloc(0) }]))).rejects.toMatchObject({ status: 400 })
    await expect(validateZipArchive(storedZip(Array.from({ length: 10001 }, (_, index) => ({ name: String(index), content: Buffer.alloc(0) }))))).rejects.toMatchObject({ status: 400 })
    await expect(validateZipArchive(storedZip(Array.from({ length: 5 }, (_, index) => ({ name: String(index), content: Buffer.alloc(0), declaredSize: ZIP_ENTRY_MAX_BYTES }))))).rejects.toMatchObject({ status: 400 })
    await expect(uploadCompleteBackup(new Request('http://localhost/import', { method: 'POST', headers: { 'Content-Type': 'application/zip', 'Content-Length': String(COMPLETE_BACKUP_MAX_BYTES + 1) }, body: 'x' }), s.admin.id)).rejects.toMatchObject({ status: 413 })
  })
  it('refuses missing managed files and paths that cannot be restored, and leaves previous backups intact', async () => {
    const s = await seed(), old = await snapshot()
    await fs.rm(resolve(uploads(), 'other/proof.txt'))
    const job = await queueCompleteBackup(s.admin.id); await runCompleteBackup(job)
    expect(job).toMatchObject({ status: 'failed', error: 'BACKUP_ATTACHMENT_MISMATCH' })
    expect(await fs.stat(artifactPath(old.id))).toBeDefined()
    await fs.writeFile(resolve(uploads(), 'C:bad.txt'), 'x')
    await expect(collectFilesExportEntries()).rejects.toMatchObject({ status: 409 })
  })
  it('rejects oversized sparse archives before parsing or extracting them', async () => {
    const path = resolve(fixture.root, 'oversized.zip')
    await fs.writeFile(path, '')
    await fs.truncate(path, ZIP_FILE_MAX_BYTES + 1)
    await expect(validateZipFile(path)).rejects.toMatchObject({ status: 413 })
    await fs.truncate(path, COMPLETE_BACKUP_MAX_BYTES + 1)
    await expect(readCompleteBundle(path, resolve(fixture.root, 'oversized'))).rejects.toMatchObject({ status: 413 })
  })
  it('rolls back files and database when the database transaction fails after importing records', async () => {
    const s = await seed(), complete = await snapshot(), preview = await previewCompleteRestore({ snapshotId: complete.id }, s.admin.id)
    await fs.writeFile(resolve(uploads(), 'other/proof.txt'), 'live'); await client.user.update({ where: { id: s.user.id }, data: { pointsBalance: 9 } })
    const original = importer.importDatabaseRecords
    vi.spyOn(importer, 'importDatabaseRecords').mockImplementationOnce(async (...args) => { await original(...args); throw new Error('injected transaction failure') })
    const job = await queueCompleteRestore(preview.id, s.admin.id); await runCompleteRestore(job, preview.id, s.session.sessionId)
    expect(job.status).toBe('failed')
    expect((await client.user.findUniqueOrThrow({ where: { id: s.user.id } })).pointsBalance).toBe(9)
    expect(await readSessionToken(s.otherSession.token)).not.toBeNull()
    expect(await fs.readFile(resolve(uploads(), 'other/proof.txt'), 'utf8')).toBe('live')
    expect(await readRestoreJournal()).toBeNull()
  })
  it('rolls back a failed file switch before touching the database', async () => {
    const s = await seed(), complete = await snapshot(), preview = await previewCompleteRestore({ snapshotId: complete.id }, s.admin.id)
    await fs.writeFile(resolve(uploads(), 'other/proof.txt'), 'live')
    fixture.failure = 'switch'
    const job = await queueCompleteRestore(preview.id, s.admin.id); await runCompleteRestore(job, preview.id, s.session.sessionId)
    expect(job.status).toBe('failed')
    expect(await fs.readFile(resolve(uploads(), 'other/proof.txt'), 'utf8')).toBe('live')
    expect(await client.article.count()).toBe(1)
    expect(await readRestoreJournal()).toBeNull()
  })
  it('stops before restoring when protection cannot be created due to missing attachments', async () => {
    const s = await seed(), complete = await snapshot(), preview = await previewCompleteRestore({ snapshotId: complete.id }, s.admin.id)
    await fs.rm(resolve(uploads(), 'other/proof.txt'))
    const job = await queueCompleteRestore(preview.id, s.admin.id); await runCompleteRestore(job, preview.id, s.session.sessionId)
    expect(job).toMatchObject({ status: 'failed', phase: 'protecting' })
    expect(await client.article.count()).toBe(1); expect(await readRestoreJournal()).toBeNull()
  })
  it('retains a committed restore despite cache and cleanup failures, and retries cleanup idempotently', async () => {
    const s = await seed(), complete = await snapshot(), preview = await previewCompleteRestore({ snapshotId: complete.id }, s.admin.id)
    await fs.writeFile(resolve(uploads(), 'other/proof.txt'), 'live')
    fixture.articleCache.mockRejectedValueOnce(new Error('injected cache error')); fixture.failure = 'cleanup'
    const job = await queueCompleteRestore(preview.id, s.admin.id); await runCompleteRestore(job, preview.id, s.session.sessionId)
    expect(job.status).toBe('succeeded'); expect(job.warnings).toEqual(expect.arrayContaining(['CACHE_REFRESH_FAILED', 'RESTORE_CLEANUP_FAILED']))
    expect(await fs.readFile(resolve(uploads(), 'other/proof.txt'), 'utf8')).toBe('data')
    const journal = (await readRestoreJournal())!
    expect(journal.resolution).toBe('committed')
    await expect(assertBackupIdle()).rejects.toMatchObject({ status: 409 })
    fixture.failure = null
    await reconcileRestoreJournal(journal, true); await recoverPendingRestore()
    expect(await readRestoreJournal()).toBeNull()
    expect(await fs.readFile(resolve(uploads(), 'other/proof.txt'), 'utf8')).toBe('data')
  })
})

describe('durable recovery, scheduling and retention', () => {
  it.each(['before-switch', 'after-old-move', 'after-new-move', 'during-rollback'])('undoes an uncommitted process interruption at %s', async (phase) => {
    await seed()
    const { journal } = await staged()
    const child = spawnSync(process.execPath, ['-e', `
      const fs = require('node:fs'), path = require('node:path');
      const [root, stage, rollback, phase] = process.argv.slice(1);
      if (phase !== 'before-switch') fs.renameSync(path.join(root, 'other'), path.join(root, rollback, 'other'));
      if (phase === 'after-new-move' || phase === 'during-rollback') fs.renameSync(path.join(root, stage, 'other'), path.join(root, 'other'));
      if (phase === 'during-rollback') {
        fs.renameSync(path.join(root, 'other'), path.join(root, stage, 'other'));
        fs.renameSync(path.join(root, rollback, 'other'), path.join(root, 'other'));
      }
      process.kill(process.pid, 'SIGKILL');
    `, uploads(), journal.stage, journal.rollback, phase])
    expect(child.signal).toBe('SIGKILL')
    await recoverPendingRestore()
    expect(await fs.readFile(resolve(uploads(), 'other/proof.txt'), 'utf8')).toBe('data')
    expect(await readRestoreJournal()).toBeNull()
  })
  it('keeps switched files after a commit receipt and makes cleanup safe to repeat', async () => {
    await seed()
    const { journal } = await staged(); await switchRestoreFiles(journal)
    await client.systemConfig.create({ data: { configKey: RESTORE_COMMIT_CONFIG_KEY, configValue: journal.jobId } })
    await recoverPendingRestore(); await recoverPendingRestore()
    expect(await fs.readFile(resolve(uploads(), 'other/proof.txt'), 'utf8')).toBe('next')
  })
  it('fails closed on startup when commit state cannot be read, preserving the journal, rollback and staging material', async () => {
    await seed()
    const { journal } = await staged(); await switchRestoreFiles(journal)
    fixture.health = 'MAINTENANCE'
    const spy = vi.spyOn(client.systemConfig, 'findUnique').mockRejectedValue(new Error('database unavailable'))
    await initializeBackupRuntime()
    expect(backupRecoveryError()).not.toBeNull()
    expect(await fs.stat(resolve(uploads(), journal.rollback, 'other/proof.txt'))).toBeDefined()
    expect(await fs.stat(resolve(uploads(), journal.stage))).toBeDefined()
    expect(await fs.stat(restoreJournalPath())).toBeDefined()
    await expect(acquireMaintenanceLock('exclusive')).rejects.toMatchObject({ status: 503 })
    spy.mockRestore()
    await recoverPendingRestore()
    expect(backupRecoveryError()).toBeNull()
    expect(await fs.readFile(resolve(uploads(), 'other/proof.txt'), 'utf8')).toBe('data')
  })
  it('defaults to disabled and computes local daily runs, including daylight-saving gaps', async () => {
    expect(await readSettings()).toEqual(DEFAULT_BACKUP_SETTINGS)
    expect(nextBackupRun(DEFAULT_BACKUP_SETTINGS)).toBeNull()
    const settings = { ...DEFAULT_BACKUP_SETTINGS, enabled: true }
    expect(nextBackupRun(settings, new Date('2026-10-08T18:59:00Z'))).toBe('2026-10-08T19:00:00.000Z')
    expect(scheduledSlot(settings, new Date('2026-10-08T19:00:00Z'))).toBe('2026-10-09')
    expect(nextBackupRun({ ...settings, dailyTime: '02:30', timeZone: 'America/New_York' }, new Date('2026-03-08T06:59:00Z'))).toBe('2026-03-08T07:00:00.000Z')
  })
  it('schedules the first enabled run in the future, triggers once, and coalesces missed days after restart', async () => {
    await seed()
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-08T20:00:00Z'))
    await saveBackupSettings({ ...DEFAULT_BACKUP_SETTINGS, enabled: true })
    await tickBackupScheduler()
    expect((await backupHistory()).snapshots).toHaveLength(0)
    vi.setSystemTime(new Date('2026-10-09T19:00:00Z')); await tickBackupScheduler(); await tickBackupScheduler()
    expect((await backupHistory()).snapshots).toHaveLength(1)
    vi.setSystemTime(new Date('2026-10-14T20:00:00Z')); await tickBackupScheduler(); await tickBackupScheduler()
    expect((await backupHistory()).snapshots).toHaveLength(2)
  })
  it('does not run while uninstalled or busy and registers only one timer outside builds', async () => {
    const s = await seed()
    vi.stubEnv('NEXT_PHASE', 'phase-production-build')
    await initializeBackupRuntime()
    const globalRuntime = globalThis as unknown as { slothVaultBackupScheduler: { timer?: ReturnType<typeof setInterval> } }
    expect(globalRuntime.slothVaultBackupScheduler.timer).toBeUndefined()
    vi.unstubAllEnvs(); process.env.APP_DATA_PATH = fixture.root
    await initializeBackupRuntime(); const timer = globalRuntime.slothVaultBackupScheduler.timer
    await initializeBackupRuntime(); expect(globalRuntime.slothVaultBackupScheduler.timer).toBe(timer)
    const job = await queueCompleteBackup(s.admin.id)
    await expect(queueCompleteBackup(s.admin.id)).rejects.toMatchObject({ status: 409 })
    await tickBackupScheduler()
    expect((await backupHistory()).snapshots).toHaveLength(0)
    releaseBackupJob(job.id)
    fixture.health = 'UNCONFIGURED'
    await tickBackupScheduler()
    expect((await backupHistory()).snapshots).toHaveLength(0)
  })
  it('retries an interrupted scheduled job on restart, but recognizes an already published snapshot as succeeded', async () => {
    await seed()
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-09T20:00:00Z'))
    const settings = { ...DEFAULT_BACKUP_SETTINGS, enabled: true }
    await saveBackupSettings(settings)
    const interrupted = await queueCompleteBackup(null, 'scheduled')
    await atomicJson(resolve(backupStatePath(), 'schedule.json'), { signature: 'Asia/Shanghai|03:00', lastSlot: scheduledSlot(settings), lastJobId: interrupted.id })
    releaseBackupJob(interrupted.id)
    const operations = (globalThis as unknown as { slothVaultBackupOperations: { finished: Map<string, unknown> } }).slothVaultBackupOperations
    operations.finished.clear()
    await initializeBackupRuntime()
    await expect.poll(async () => (await backupHistory()).snapshots.length).toBe(1)
    await expect.poll(async () => (await backupHistory()).activeJob).toBeNull()
    await tickBackupScheduler()
    expect((await backupHistory()).snapshots).toHaveLength(1)
    const published = (await backupHistory()).jobs.find((job) => job.status === 'succeeded')!
    await atomicJson(recordPath('jobs', published.id), { ...published, status: 'running' })
    operations.finished.clear()
    const runtime = (globalThis as unknown as { slothVaultBackupScheduler: { initialized?: Promise<void> } }).slothVaultBackupScheduler
    runtime.initialized = undefined
    await initializeBackupRuntime(); await tickBackupScheduler()
    expect((await getBackupJob(published.id)).status).toBe('succeeded')
    expect((await backupHistory()).snapshots).toHaveLength(1)
  })
  it('prunes only unpinned scheduled backups after success and never on disk-space failure', async () => {
    const s = await seed()
    await saveBackupSettings({ ...DEFAULT_BACKUP_SETTINGS, retentionCount: 1 })
    const first = await queueCompleteBackup(s.admin.id, 'scheduled'); await runCompleteBackup(first)
    const manual = await snapshot(), protect = await createCompleteSnapshot('protect', randomUUID(), async () => undefined)
    const release = pinSnapshot(first.id)
    const second = await queueCompleteBackup(s.admin.id, 'scheduled'); await runCompleteBackup(second)
    expect((await backupHistory()).snapshots).toHaveLength(4)
    release()
    fixture.failure = 'space'
    const failed = await queueCompleteBackup(s.admin.id, 'scheduled'); await runCompleteBackup(failed)
    expect(failed).toMatchObject({ status: 'failed', error: 'STORAGE_FULL' })
    expect((await backupHistory()).snapshots).toHaveLength(4)
    fixture.failure = null
    const third = await queueCompleteBackup(s.admin.id, 'scheduled'); await runCompleteBackup(third)
    expect((await backupHistory()).snapshots.map((item) => item.id).sort()).toEqual([manual.id, protect.id, third.id].sort())
  })
  it('pins previews and refuses changed or expired restore sources', async () => {
    const s = await seed(), complete = await snapshot(), preview = await previewCompleteRestore({ snapshotId: complete.id }, s.admin.id)
    await expect(deleteBackupSnapshot(complete.id)).rejects.toMatchObject({ status: 409 })
    await fs.appendFile(artifactPath(complete.id), 'tamper')
    await expect(queueCompleteRestore(preview.id, s.admin.id)).rejects.toMatchObject({ status: 409 })
    expect(sourceIsPinned(complete.id)).toBe(false)
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(preview.expiresAt).getTime() + 1)
    await expect(queueCompleteRestore(preview.id, s.admin.id)).rejects.toMatchObject({ status: 409 })
  })
  it('rejects backup roots overlapping protected storage, including ancestor symlinks before creating directories', async () => {
    await seed()
    process.env.BACKUP_STORAGE_PATH = uploads()
    expect((await storageStatus()).error).toBe('STORAGE_UNAVAILABLE')
    await fs.symlink(uploads(), resolve(fixture.root, 'alias'))
    process.env.BACKUP_STORAGE_PATH = resolve(fixture.root, 'alias/should-not-exist')
    await expect(ensureBackupStorage()).rejects.toMatchObject({ status: 503 })
    await expect(fs.stat(resolve(uploads(), 'should-not-exist'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('administrator backup API boundaries', () => {
  it('requires an administrator session on every new endpoint and rejects non-administrators', async () => {
    const s = await seed(), id = randomUUID(), ctx = { params: Promise.resolve({}) }, idCtx = context(id)
    const calls = [
      settingsGet(request('settings'), ctx), settingsPut(request('settings', { method: 'PUT', body: {} }), ctx),
      historyGet(request('snapshots'), ctx), snapshotPost(request('snapshots', { method: 'POST', body: {} }), ctx),
      downloadGet(request('download'), idCtx), snapshotDelete(request('snapshot', { method: 'DELETE', body: {} }), idCtx),
      uploadPost(request('imports', { method: 'POST', body: {} }), ctx), previewPost(request('preview', { method: 'POST', body: {} }), ctx),
      restorePost(request('restore', { method: 'POST', body: {} }), ctx), jobGet(request('job'), idCtx),
    ]
    expect((await Promise.all(calls)).map((response) => response.status)).toEqual(Array(10).fill(401))
    expect((await historyGet(request('snapshots', { token: s.otherSession.token }), ctx)).status).toBe(401)
  })
  it('returns queued jobs before after() starts work, polls status while the state lock is held, and downloads native ZIP data', async () => {
    const s = await seed(), ctx = { params: Promise.resolve({}) }
    const accepted = await snapshotPost(request('snapshots', { method: 'POST', token: s.session.token, body: {} }), ctx)
    expect(accepted.status).toBe(202)
    const job = (await accepted.json()).data
    expect(job.status).toBe('queued'); expect(fixture.after).toHaveLength(1)
    const release = await acquireMaintenanceLock('exclusive')
    const progress = await jobGet(request('job', { token: s.session.token }), context(job.id))
    expect(progress.status).toBe(200)
    expect((await progress.json()).data.status).toBe('queued'); release()
    for (const callback of fixture.after) await callback()
    expect((await getBackupJob(job.id)).status).toBe('succeeded')
    const download = await downloadGet(request('download', { token: s.session.token }), context(job.id))
    expect(download.headers.get('content-type')).toBe('application/zip')
    expect(digest(Buffer.from(await download.arrayBuffer()))).toBe(await sha256File(artifactPath(job.id)))
    expect((await downloadGet(request('download', { token: s.session.token }), context('../config'))).status).toBe(400)
  })
  it('requires typed restore confirmation and rejects legacy destructive actions while a complete task is reserved', async () => {
    const s = await seed(), ctx = { params: Promise.resolve({}) }
    const response = await restorePost(request('restores', { method: 'POST', token: s.session.token, body: { previewId: randomUUID(), confirm: 'yes' } }), ctx)
    expect(response.status).toBe(400); expect(fixture.after).toHaveLength(0)
    const job = await queueCompleteBackup(s.admin.id)
    const responses = await Promise.all([legacyImportPost(request('database-import', { method: 'POST', token: s.session.token, body: {} }), ctx), legacyFilesPost(request('files-import', { method: 'POST', token: s.session.token, body: {} }), ctx), resetPost(request('system-reset', { method: 'POST', token: s.session.token, body: { confirm: 'RESET_ALL_DATA' } }), ctx)])
    expect(responses.map((item) => item.status)).toEqual([409, 409, 409])
    releaseBackupJob(job.id)
    expect(await client.article.count()).toBe(1)
  })
})
