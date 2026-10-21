import { canonicalProjectVersionEvidenceMemo } from '@/server/services/project-version-evidence-protocol'
import { parseReleaseManifest } from '@/server/services/release-manifest'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { basename, resolve } from 'node:path'
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
  publicationFailure: null as 'index' | 'receipt' | null,
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
      if (fixture.publicationFailure === 'index' && destination.includes('/backup-state/snapshots/')) {
        fixture.publicationFailure = null
        throw Object.assign(new Error('injected import index failure'), { code: 'EIO' })
      }
      if (fixture.publicationFailure === 'receipt' && destination.includes('/backup-state/imports/') && await actual.lstat(resolve(fixture.root, 'config/backup-state/snapshots', basename(destination))).catch(() => null)) {
        fixture.publicationFailure = null
        throw Object.assign(new Error('injected import receipt failure'), { code: 'EIO' })
      }
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
import * as archiveOperations from './archive'
import { createCompleteSnapshot, readCompleteBundle, sha256File, walkBackupFiles } from './archive'
import { applyBackupRetention, assertBackupIdle, backupHistory, deleteBackupSnapshot, getBackupJob, previewCompleteRestore, queueCompleteBackup, queueCompleteImport, queueCompleteRestore, runCompleteBackup, runCompleteImport, runCompleteRestore } from './complete'
import { artifactPath, atomicJson, backupStatePath, backupStoragePath, DEFAULT_BACKUP_SETTINGS, ensureBackupStorage, getBackupSnapshot, importPath, pinSnapshot, readJson, readSettings, recordPath, releaseBackupJob, sourceIsPinned, storageStatus, updateBackupJob } from './store'
import { prepareRestoreJournal, readRestoreJournal, reconcileRestoreJournal, recoverPendingRestore, restoreJournalPath, switchRestoreFiles } from './recovery'
import { backupRecoveryError, setBackupRecoveryError } from './recovery-state'
import { initializeBackupRuntime, nextBackupRun, saveBackupSettings, scheduledSlot, tickBackupScheduler } from './scheduler'
import { ACTIVE_BACKUP_COLLECTION_KEYS, DATABASE_BACKUP_VERSION, RESTORE_COMMIT_CONFIG_KEY } from './constants'
import { extractZipToStaging } from './files-import'
import { updateCrc32, validateZipArchive, validateZipFile } from './zip-validation'
import { rebuildFileReferences } from '@/server/services/file-references'
import { publishProjectVersion } from '@/server/services/project-version-release'
import { getPublicReleaseEvidence, getAdminReleaseEvidence } from '@/server/services/release-evidence'
import { createCommission, getCommission } from '@/server/commissions/service'
import { createCommissionDocument } from '@/server/commissions/documents'
import { listContractTemplates } from '@/server/commissions/templates'
import { completeAgreementValues, seedSignedLegacyContract } from '@/server/commissions/test-fixtures'
import { uploadCommissionFile } from '@/server/commissions/files'
import { GET as settingsGet, PUT as settingsPut } from '@/app/api/admin/mm/backup/settings/route'
import { GET as historyGet, POST as snapshotPost } from '@/app/api/admin/mm/backup/snapshots/route'
import { POST as importPost } from '@/app/api/admin/mm/backup/snapshots/import/route'
import { GET as jobGet } from '@/app/api/admin/mm/backup/jobs/[id]/route'
import { GET as downloadGet, HEAD as downloadHead } from '@/app/api/admin/mm/backup/snapshots/[id]/download/route'
import { DELETE as snapshotDelete } from '@/app/api/admin/mm/backup/snapshots/[id]/route'
import { GET as uploadGet, PATCH as uploadPatch, DELETE as uploadDelete } from '@/app/api/admin/mm/backup/imports/[id]/route'
import { POST as uploadCompletePost } from '@/app/api/admin/mm/backup/imports/[id]/complete/route'
import { POST as uploadPost } from '@/app/api/admin/mm/backup/imports/route'
import { POST as previewPost } from '@/app/api/admin/mm/backup/restores/preview/route'
import { POST as restorePost } from '@/app/api/admin/mm/backup/restores/route'
import { cancelBackupUpload, createBackupUpload, appendBackupUpload, completeBackupUpload, getBackupUpload, reconcileBackupUploads, type BackupUploadRecord } from './uploads'
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
  const manifest = JSON.parse(entries.get('manifest.json')!.toString()) as BackupManifest
  const database = { version: manifest.databaseVersion, exportedAt: manifest.createdAt, data: Object.fromEntries(ACTIVE_BACKUP_COLLECTION_KEYS.map(key => [key, entries.get(`database/${key}.ndjson`)!.toString().split('\n').filter(Boolean).map(line => JSON.parse(line))])) } as Exported
  edit(database, manifest, entries)
  manifest.databaseVersion = database.version
  manifest.counts = Object.fromEntries(Object.entries(database.data).map(([key, rows]) => [key, rows.length]))
  for (const key of ACTIVE_BACKUP_COLLECTION_KEYS) {
    const rows = (database.data as Record<string, unknown[]>)[key]
    const name = `database/${key}.ndjson`
    if (!rows) { entries.delete(name); delete manifest.database[key]; continue }
    const data = Buffer.from(rows.map(row => JSON.stringify(row) + '\n').join(''))
    entries.set(name, data); manifest.database[key] = { size: data.length, sha256: digest(data) }
  }
  const files = entries.get('files.ndjson')!
  manifest.filesIndex = { size: files.length, sha256: digest(files) }
  entries.set('manifest.json', Buffer.from(JSON.stringify(manifest)))
  return storedZip([...entries].map(([name, content]) => ({ name, content })))
}
async function uploaded(bytes: Buffer, adminId: number) {
  let session = await createBackupUpload({ size: bytes.length, fileName: 'backup.zip', lastModified: 0, fingerprint: digest(bytes) }, adminId)
  while (session.offset < bytes.length) {
    const chunk = bytes.subarray(session.offset, session.offset + session.chunkSize)
    session = await appendBackupUpload(session.importId, adminId, new Request('http://localhost/import', { method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream', 'Upload-Offset': String(session.offset), 'X-Chunk-SHA256': digest(chunk) }, body: new Uint8Array(chunk) }))
  }
  return completeBackupUpload(session.importId, adminId)
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
  fixture.failure = null; fixture.publicationFailure = null; fixture.health = 'INSTALLED'; fixture.after = []
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
  fixture.publicationFailure = null
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
  const user = await client.user.create({ data: { username: 'member', password: 'backup-member-hash', pointsBalance: 100, email: 'member@example.invalid', walletAddress: '1'.repeat(32), wallets: { create: { address: '1'.repeat(32) } } } })
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
  const menu = await client.projectMenu.create({ data: { projectId: project.id, label: 'Deleted menu', icon: 'github', weight: 0, status: 0, isDeleted: true, deletedAt } })
  await client.projectMenu.create({ data: { projectId: project.id, parentId: menu.id, label: 'Deleted child', icon: 'none', weight: 0, status: 0, isDeleted: true, deletedAt } })
  await client.$transaction((tx) => rebuildFileReferences(tx))
  const session = await issueSession({ userId: admin.id })
  const otherSession = await issueSession({ userId: user.id })
  await client.mcpApiKey.create({ data: { userId: user.id, publicId: randomUUID().replaceAll('-', ''), secretHash: 'test-only', name: 'old-key' } })
  await client.systemInstallation.create({ data: { id: 1, provider: fixture.provider, status: 'INSTALLED', schemaRevision: 10, installationId: randomUUID() } })
  return { admin, user, file, project, release, session, otherSession }
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
    await client.projectMenu.create({ data: { projectId: s.project.id, label: 'Automatic menu' } })
    const actor = { userId: s.admin.id, isAdmin: true, sessionId: s.session.sessionId }
    let commission = await createCommission({ userId: s.user.id, isAdmin: false }, { commandId: randomUUID(), title: 'Restore evidence', purpose: 'Backup', requirements: 'Preserve signed snapshots' })
    const template = (await listContractTemplates())[0].versions.find((version) => version.status === 'PUBLISHED')!
    commission = await createCommissionDocument(Number(commission.id), actor, { commandId: randomUUID(), revision: commission.revision, templateVersionId: Number(template.id), documentType: 'AGREEMENT', values: completeAgreementValues() })
    const document = commission.documents[0]
    await seedSignedLegacyContract(client, Number(document.id))
    await uploadCommissionFile(Number(commission.id), actor, new Request('http://localhost/file', { method: 'POST', body: 'frozen commission file' }), { name: 'source.txt', purpose: 'DELIVERY', shared: false, commandId: randomUUID() })
    await client.releaseCredential.create({ data: {
      projectVersionId: Number(s.release.projectVersionId), issuerUserId: s.admin.id,
      subjectType: 'PROJECT_VERSION', subjectId: s.release.releaseId, subjectHash: s.release.releaseHash,
      subjectManifestVersion: s.release.manifestVersion, network: 'devnet',
      signerAddress: '11111111111111111111111111111111', memo: canonicalProjectVersionEvidenceMemo({ installationId: randomUUID(), releaseId: s.release.releaseId, manifest: parseReleaseManifest((await client.projectVersion.findUniqueOrThrow({ where: { id: Number(s.release.projectVersionId) } })).releaseManifestJson), releaseHash: s.release.releaseHash, network: 'devnet', signer: '11111111111111111111111111111111' }),
      transactionSignature: '5'.repeat(88), status: 2,
    } })
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
    expect(restored.data.projectMenus).toHaveLength(3)
    const menuChoices = (data: Exported) => Object.fromEntries(data.data.projectMenus.map(menu => [menu.label, { icon: menu.icon, isDeleted: menu.isDeleted }]))
    expect(menuChoices(restored)).toEqual(menuChoices(before))
    expect(restored.data.projectMenus.find(menu => menu.label === 'Deleted child')!.parentId).toBe(restored.data.projectMenus.find(menu => menu.label === 'Deleted menu')!.id)
    expect(restored.data.fileManagements[0].status).toBe(0)
    expect(restored.data.fileReferences).toHaveLength(before.data.fileReferences.length)
    expect(restored.data.projects[0]).toMatchObject({ readAccessMode: 'MEMBERSHIPS', downloadAccessMode: 'DISABLED' })
    expect(restored.data.projectVersions.find((version) => version.releaseId === s.release.releaseId)?.releaseHash).toBe(s.release.releaseHash)
    expect(restored.data.releaseCredentials).toHaveLength(1)
    expect(restored.data.releaseCredentials[0]).toMatchObject({ subjectType: 'PROJECT_VERSION', transactionSignature: '5'.repeat(88) })
    expect(await getPublicReleaseEvidence('5'.repeat(88))).toMatchObject({ subjectType: 'PROJECT_VERSION', subjectHash: s.release.releaseHash })
    expect(await getAdminReleaseEvidence(Number(restored.data.releaseCredentials[0].id))).toMatchObject({ manifest: { schema: 3 } })
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
  it('requires every current collection and rejects older data versions', async () => {
    const s = await seed(), complete = await snapshot()
    const missing = await editedBundle(complete, (database) => { Reflect.deleteProperty(database.data, 'commissionEvents') })
    await expect(previewCompleteRestore(await uploaded(missing, s.admin.id), s.admin.id)).rejects.toMatchObject({ status: 400 })
    const old = await editedBundle(complete, (database) => { Reflect.set(database, 'version', '2.9.0'); Reflect.deleteProperty(database.data, 'commissionEvents') })
    await expect(previewCompleteRestore(await uploaded(old, s.admin.id), s.admin.id)).rejects.toMatchObject({ status: 400, data: { reason: 'BACKUP_UNSUPPORTED_FORMAT' } })
    expect(await client.article.count()).toBe(1)
  })
  it('reports standalone JSON, attachment ZIP and old complete ZIP as unsupported formats', async () => {
    const s = await seed()
    const sources = [
      Buffer.from(JSON.stringify({ version: '2.12.0', data: { users: [] } })),
      storedZip([{ name: 'other/proof.txt', content: Buffer.from('data') }]),
      storedZip([{ name: 'manifest.json', content: Buffer.from(JSON.stringify({ formatVersion: 1, databaseVersion: '2.12.0' })) }]),
    ]
    for (const bytes of sources) {
      await expect(previewCompleteRestore(await uploaded(bytes, s.admin.id), s.admin.id)).rejects.toMatchObject({ status: 400, data: { reason: 'BACKUP_UNSUPPORTED_FORMAT' } })
    }
    expect(await client.article.count()).toBe(1)
    expect(await fs.readFile(resolve(uploads(), 'other/proof.txt'), 'utf8')).toBe('data')
  })
  it('rejects outer checksum tampering and frozen attachment hash mismatches without publishing a backup', async () => {
    const s = await seed(), complete = await snapshot()
    const damaged = await fs.readFile(artifactPath(complete.id))
    damaged[30 + damaged.readUInt16LE(26) + damaged.readUInt16LE(28)] ^= 1
    await expect(previewCompleteRestore(await uploaded(damaged, s.admin.id), s.admin.id)).rejects.toMatchObject({ status: 400 })
    const corrupt = await editedBundle(complete, (_database, _manifest, entries) => { const rows = entries.get('files.ndjson')!.toString().split('\n').filter(Boolean).map(line => JSON.parse(line)); rows.find(row => row.kind === 'file').sha256 = '0'.repeat(64); entries.set('files.ndjson', Buffer.from(rows.map(row => JSON.stringify(row) + '\n').join(''))) })
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
  it('rejects broken ZIP checksums and duplicate entries while accepting large entry inventories', async () => {
    await seed()
    const corrupt = storedZip([{ name: 'other/data.txt', content: Buffer.from('data') }]); corrupt[30 + Buffer.byteLength('other/data.txt')] ^= 1
    const archive = resolve(fixture.root, 'bad.zip'); await fs.writeFile(archive, corrupt)
    const staging = resolve(fixture.root, 'crc-check'); await fs.mkdir(staging)
    await expect(extractZipToStaging(await validateZipArchive(corrupt), staging)).rejects.toMatchObject({ status: 400 })
    await expect(readCompleteBundle(archive, resolve(fixture.root, 'bad'))).rejects.toMatchObject({ status: 400 })
    await expect(validateZipArchive(storedZip([{ name: 'same', content: Buffer.alloc(0) }, { name: 'SAME', content: Buffer.alloc(0) }]))).rejects.toMatchObject({ status: 400 })
    expect(await validateZipArchive(storedZip(Array.from({ length: 10001 }, (_, index) => ({ name: String(index), content: Buffer.alloc(0) }))))).toHaveLength(10001)
    const oversizedEntry = await validateZipArchive(storedZip([{ name: 'huge', content: Buffer.alloc(0), declaredSize: 257 * 1024 * 1024 }]))
    await expect(extractZipToStaging(oversizedEntry, staging)).rejects.toMatchObject({ status: 400 })
  })
  it('refuses missing managed files and paths that cannot be restored, and leaves previous backups intact', async () => {
    const s = await seed(), old = await snapshot()
    await fs.rm(resolve(uploads(), 'other/proof.txt'))
    const job = await queueCompleteBackup(s.admin.id); await runCompleteBackup(job)
    expect(job).toMatchObject({ status: 'failed', error: 'BACKUP_ATTACHMENT_MISMATCH' })
    expect(await fs.stat(artifactPath(old.id))).toBeDefined()
    await fs.writeFile(resolve(uploads(), 'C:bad.txt'), 'x')
    await expect((async () => { for await (const entry of walkBackupFiles()) void entry })()).rejects.toMatchObject({ status: 409 })
  })
  it('rejects invalid sparse archives by their structure, without a total size cap', async () => {
    const path = resolve(fixture.root, 'oversized.zip')
    await fs.writeFile(path, '')
    await fs.truncate(path, 251 * 1024 * 1024)
    await expect(validateZipFile(path)).rejects.toMatchObject({ status: 400 })
    await fs.truncate(path, 321 * 1024 * 1024)
    await expect(readCompleteBundle(path, resolve(fixture.root, 'oversized'))).rejects.toMatchObject({ status: 400 })
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

describe('persistent imported backup nodes', () => {
  it('returns duplicate task requests and rejects cancellation while validation is still running', async () => {
    const s = await seed(), original = await snapshot(), source = await uploaded(await fs.readFile(artifactPath(original.id)), s.admin.id)
    const { job } = await queueCompleteImport(source.importId, s.admin.id)
    let releaseValidation!: () => void
    const gate = new Promise<void>(resolveGate => { releaseValidation = resolveGate })
    const reader = archiveOperations.readCompleteBundle
    vi.spyOn(archiveOperations, 'readCompleteBundle').mockImplementation(async (...args) => { await gate; return reader(...args) })
    const running = runCompleteImport(job)
    try {
      await expect.poll(() => job.status).toBe('running')
      expect((await queueCompleteImport(source.importId, s.admin.id)).job.id).toBe(job.id)
      await expect(cancelBackupUpload(source.importId, s.admin.id)).rejects.toMatchObject({ status: 409 })
    } finally { releaseValidation(); await running }
    expect(job.status).toBe('succeeded')
  })

  it('queues one background import per owned upload and supports downloading the imported node', async () => {
    const s = await seed(), original = await snapshot(), bytes = await fs.readFile(artifactPath(original.id))
    const source = await uploaded(bytes, s.admin.id), ctx = { params: Promise.resolve({}) }
    const admin = await client.user.create({ data: { username: 'another-admin', password: 'test-only', role: 'ADMIN' } })
    const session = await issueSession({ userId: admin.id })
    const submit = (token: string) => importPost(request('snapshots/import', { method: 'POST', token, body: source }), ctx)
    expect((await submit(s.otherSession.token)).status).toBe(401)
    expect((await submit(session.token)).status).toBe(404)
    expect((await importPost(request('snapshots/import', { method: 'POST', token: s.session.token, body: { importId: '../unsafe' } }), ctx)).status).toBe(400)
    const first = await submit(s.session.token), repeated = await submit(s.session.token)
    expect(first.status).toBe(202); expect(repeated.status).toBe(202)
    const job = (await first.json()).data
    expect((await repeated.json()).data.id).toBe(job.id)
    expect(fixture.after).toHaveLength(1)
    expect((await backupHistory()).snapshots).toHaveLength(1)
    await expect(cancelBackupUpload(source.importId, s.admin.id)).rejects.toMatchObject({ status: 409 })
    await fixture.after[0]()
    expect((await getBackupJob(job.id)).status).toBe('succeeded')
    expect((await (await submit(s.session.token)).json()).data.id).toBe(job.id)
    expect(fixture.after).toHaveLength(1)
    const download = await downloadGet(request('download', { token: s.session.token }), context(source.importId))
    expect(download.status).toBe(200)
    await expect(deleteBackupSnapshot(source.importId)).rejects.toMatchObject({ status: 409 })
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes)
    await deleteBackupSnapshot(source.importId)
    expect((await backupHistory()).snapshots).toHaveLength(1)
  })

  it('imports and restores pre-icon 2.18 ZIP data without changing archive bytes or emitting retired-card warnings', async () => {
    const s = await seed(), original = await snapshot()
    const bytes = await editedBundle(original, data => {
      Reflect.set(data, 'version', '2.18.0')
      for (const menu of data.data.projectMenus) Reflect.deleteProperty(menu, 'icon')
    })
    const source = await uploaded(bytes, s.admin.id), { job } = await queueCompleteImport(source.importId, s.admin.id)
    await runCompleteImport(job)
    expect(job.status).toBe('succeeded')
    const imported = await getBackupSnapshot(source.importId)
    const preview = await previewCompleteRestore({ snapshotId: imported.id }, s.admin.id)
    expect(preview.warnings).toEqual([])
    expect(imported.manifest.databaseVersion).toBe('2.18.0')
    const restore = await queueCompleteRestore(preview.id, s.admin.id)
    await runCompleteRestore(restore, preview.id, s.session.sessionId)
    expect(restore.status).toBe('succeeded')
    const restored = await exportDatabaseBackup()
    expect(restored.version).toBe(DATABASE_BACKUP_VERSION)
    expect(restored.data.projectMenus.map(menu => menu.icon)).toEqual([null, null])
    expect(await fs.readFile(artifactPath(imported.id))).toEqual(bytes)
  })

  it('keeps original bytes after restart and upload expiry, then restores only when requested', async () => {
    const s = await seed(), original = await snapshot(), bytes = await fs.readFile(artifactPath(original.id))
    const source = await uploaded(bytes, s.admin.id)
    await client.user.update({ where: { id: s.user.id }, data: { pointsBalance: 9 } })
    await fs.writeFile(resolve(uploads(), 'other/proof.txt'), 'live')
    const requests = await Promise.all([queueCompleteImport(source.importId, s.admin.id), queueCompleteImport(source.importId, s.admin.id)])
    // Concurrent callers may reach the reservation in either order, but only one starts the shared job.
    expect(requests.filter(item => item.queued)).toHaveLength(1)
    expect(requests[0].job.id).toBe(requests[1].job.id)
    await runCompleteImport(requests[0].job)
    const imported = await getBackupSnapshot(source.importId)
    expect(imported).toMatchObject({ kind: 'imported', fileName: 'backup.zip', createdAt: original.createdAt, manifest: original.manifest })
    expect(imported.id).not.toBe(original.id)
    expect(imported.importedAt).toBeDefined()
    expect(await fs.readFile(artifactPath(imported.id))).toEqual(bytes)
    expect((await queueCompleteImport(source.importId, s.admin.id)).queued).toBe(false)
    expect((await getBackupJob(requests[0].job.id)).status).toBe('succeeded')
    expect((await client.user.findUniqueOrThrow({ where: { id: s.user.id } })).pointsBalance).toBe(9)
    expect(await fs.readFile(resolve(uploads(), 'other/proof.txt'), 'utf8')).toBe('live')
    expect((await backupHistory()).snapshots).toHaveLength(2)
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 25 * 3600_000)
    await initializeBackupRuntime()
    expect(await readJson(recordPath('imports', source.importId))).toBeNull()
    expect((await backupHistory()).snapshots[0]).toMatchObject({ id: imported.id, restorable: true, compatibility: { status: 'current' } })
    expect(await fs.readFile(artifactPath(imported.id))).toEqual(bytes)
    const preview = await previewCompleteRestore({ snapshotId: imported.id }, s.admin.id)
    await expect(deleteBackupSnapshot(imported.id)).rejects.toMatchObject({ status: 409 })
    const job = await queueCompleteRestore(preview.id, s.admin.id)
    await runCompleteRestore(job, preview.id, s.session.sessionId)
    expect((await getBackupJob(job.id)).status).toBe('succeeded')
    expect(job.protectionId).toBeDefined()
    expect((await client.user.findUniqueOrThrow({ where: { username: 'member' } })).pointsBalance).toBe(100)
    expect(await fs.readFile(resolve(uploads(), 'other/proof.txt'), 'utf8')).toBe('data')
  })

  it('defers destination credential conflicts to restore preflight', async () => {
    const s = await seed(), original = await snapshot()
    const bytes = await editedBundle(original, data => { data.data.users.find(user => user.username === 'member')!.email = 'current@example.invalid' })
    await client.user.update({ where: { id: s.admin.id }, data: { email: 'current@example.invalid' } })
    const source = await uploaded(bytes, s.admin.id), { job } = await queueCompleteImport(source.importId, s.admin.id)
    await runCompleteImport(job)
    expect(job.status).toBe('succeeded')
    await expect(previewCompleteRestore({ snapshotId: source.importId }, s.admin.id)).rejects.toMatchObject({ status: 409 })
    expect(await client.article.count()).toBe(1)
  })

  it.each(['checksum', 'attachment', 'relation', 'path', 'missing-field', 'old-version', 'future-version'])('rejects %s without publishing or modifying existing nodes', async kind => {
    const s = await seed(), original = await snapshot()
    const bytes = await editedBundle(original, (data, _manifest, entries) => {
      if (kind === 'attachment') {
        const rows = entries.get('files.ndjson')!.toString().split('\n').filter(Boolean).map(line => JSON.parse(line))
        rows.find(row => row.kind === 'file').sha256 = '0'.repeat(64)
        entries.set('files.ndjson', Buffer.from(rows.map(row => JSON.stringify(row) + '\n').join('')))
      }
      if (kind === 'relation') data.data.membershipGrants[0].userId = '99999'
      if (kind === 'path') entries.set('../escape.txt', Buffer.from('unsafe'))
      if (kind === 'missing-field') Reflect.deleteProperty(data.data.projects[0], 'readAccessMode')
      if (kind === 'old-version' || kind === 'future-version') Reflect.set(data, 'version', kind === 'old-version' ? '2.12.0' : '2.16.0')
    })
    if (kind === 'checksum') bytes[30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28)] ^= 1
    const source = await uploaded(bytes, s.admin.id), { job } = await queueCompleteImport(source.importId, s.admin.id)
    await runCompleteImport(job)
    expect(job.status).toBe('failed')
    expect((await backupHistory()).snapshots.map(item => item.id)).toEqual([original.id])
    expect(await client.article.count()).toBe(1)
    expect(await fs.readFile(resolve(uploads(), 'other/proof.txt'), 'utf8')).toBe('data')
    await cancelBackupUpload(source.importId, s.admin.id)
  })

  it.each(['before-move', 'after-move', 'after-index'])('reconciles a durable publication interrupted at %s', async stage => {
    const s = await seed(), original = await snapshot(), bytes = await fs.readFile(artifactPath(original.id))
    const source = await uploaded(bytes, s.admin.id), { job } = await queueCompleteImport(source.importId, s.admin.id)
    const record = (await readJson<BackupUploadRecord>(recordPath('imports', source.importId)))!
    const publication: BackupSnapshot = { ...original, id: source.importId, kind: 'imported', importedAt: new Date().toISOString(), fileName: record.fileName }
    await atomicJson(recordPath('imports', source.importId), { ...record, publication })
    await updateBackupJob(job, { status: 'running', phase: 'validating' })
    if (stage !== 'before-move') await fs.rename(importPath(source.importId), artifactPath(source.importId))
    if (stage === 'after-index') await atomicJson(recordPath('snapshots', source.importId), publication)
    releaseBackupJob(job.id)
    ;(globalThis as unknown as { slothVaultBackupOperations: { finished: Map<string, unknown> } }).slothVaultBackupOperations.finished.clear()
    await initializeBackupRuntime()
    expect((await getBackupJob(job.id)).status).toBe('succeeded')
    expect((await backupHistory()).snapshots).toHaveLength(2)
    expect((await getBackupUpload(source.importId, s.admin.id)).snapshotId).toBe(source.importId)
    expect(await fs.readFile(artifactPath(source.importId))).toEqual(bytes)
    await reconcileBackupUploads()
    expect((await backupHistory()).snapshots).toHaveLength(2)
  })

  it('keeps unvalidated uploads available for retry after interruption', async () => {
    const s = await seed(), original = await snapshot(), source = await uploaded(await fs.readFile(artifactPath(original.id)), s.admin.id)
    const first = await queueCompleteImport(source.importId, s.admin.id)
    releaseBackupJob(first.job.id)
    ;(globalThis as unknown as { slothVaultBackupOperations: { finished: Map<string, unknown> } }).slothVaultBackupOperations.finished.clear()
    await initializeBackupRuntime()
    expect((await getBackupJob(first.job.id)).status).toBe('interrupted')
    expect((await getBackupUpload(source.importId, s.admin.id)).state).toBe('uploaded')
    const retry = await queueCompleteImport(source.importId, s.admin.id)
    expect(retry.queued).toBe(true)
    await runCompleteImport(retry.job)
    expect(retry.job.status).toBe('succeeded')
  })

  it('keeps a damaged interrupted publication unavailable and allows explicit cleanup', async () => {
    const s = await seed(), original = await snapshot(), bytes = await fs.readFile(artifactPath(original.id))
    const source = await uploaded(bytes, s.admin.id), { job } = await queueCompleteImport(source.importId, s.admin.id)
    const record = (await readJson<BackupUploadRecord>(recordPath('imports', source.importId)))!
    await atomicJson(recordPath('imports', source.importId), { ...record, publication: { ...original, id: source.importId, kind: 'imported', importedAt: new Date().toISOString() } })
    await fs.rename(importPath(source.importId), artifactPath(source.importId))
    bytes[bytes.length - 1] ^= 1; await fs.writeFile(artifactPath(source.importId), bytes)
    releaseBackupJob(job.id)
    ;(globalThis as unknown as { slothVaultBackupOperations: { finished: Map<string, unknown> } }).slothVaultBackupOperations.finished.clear()
    await initializeBackupRuntime()
    expect((await getBackupJob(job.id)).status).toBe('interrupted')
    expect((await backupHistory()).snapshots.map(item => item.id)).toEqual([original.id])
    await cancelBackupUpload(source.importId, s.admin.id)
    await expect(fs.stat(artifactPath(source.importId))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recovers failed index publication and reports committed imports despite receipt failures', async () => {
    const s = await seed(), original = await snapshot(), bytes = await fs.readFile(artifactPath(original.id))
    const source = await uploaded(bytes, s.admin.id), first = await queueCompleteImport(source.importId, s.admin.id)
    fixture.publicationFailure = 'index'
    await runCompleteImport(first.job)
    expect(first.job.status).toBe('failed')
    expect(await readJson(recordPath('snapshots', source.importId))).toBeNull()
    ;(globalThis as unknown as { slothVaultBackupOperations: { finished: Map<string, unknown> } }).slothVaultBackupOperations.finished.clear()
    await initializeBackupRuntime()
    expect((await getBackupJob(first.job.id)).status).toBe('succeeded')
    const another = await uploaded(bytes, s.admin.id), second = await queueCompleteImport(another.importId, s.admin.id)
    fixture.publicationFailure = 'receipt'
    await runCompleteImport(second.job)
    expect(second.job.status).toBe('succeeded')
    expect(second.job.warnings).toContain('JOB_STATE_WRITE_FAILED')
    await deleteBackupSnapshot(another.importId)
    await reconcileBackupUploads()
    expect(await readJson(recordPath('snapshots', another.importId))).toBeNull()
    expect((await backupHistory()).snapshots).toHaveLength(2)
  })

  it('rechecks imported bytes before restore and excludes imported nodes from retention', async () => {
    const s = await seed(), original = await snapshot(), source = await uploaded(await fs.readFile(artifactPath(original.id)), s.admin.id)
    const { job } = await queueCompleteImport(source.importId, s.admin.id)
    await runCompleteImport(job)
    await atomicJson(resolve(backupStatePath(), 'settings.json'), { ...DEFAULT_BACKUP_SETTINGS, retentionCount: 1 })
    await createCompleteSnapshot('scheduled', randomUUID(), async () => undefined)
    await createCompleteSnapshot('scheduled', randomUUID(), async () => undefined)
    await applyBackupRetention()
    expect((await backupHistory()).snapshots.filter(item => item.kind === 'scheduled')).toHaveLength(1)
    const preview = await previewCompleteRestore({ snapshotId: source.importId }, s.admin.id)
    const restore = await queueCompleteRestore(preview.id, s.admin.id)
    const bytes = await fs.readFile(artifactPath(source.importId)); bytes[bytes.length - 1] ^= 1
    await fs.writeFile(artifactPath(source.importId), bytes)
    await runCompleteRestore(restore, preview.id, s.session.sessionId)
    expect(restore.status).toBe('failed')
    expect(restore.protectionId).toBeUndefined()
    expect(await client.article.count()).toBe(1)
    expect((await backupHistory()).snapshots).toHaveLength(3)
  })

  it('admits older application releases with the same data format and describes incompatible historical nodes', async () => {
    const s = await seed(), original = await snapshot()
    const bytes = await editedBundle(original, (_data, manifest) => { manifest.appVersion = '1.0.0' })
    const source = await uploaded(bytes, s.admin.id), { job } = await queueCompleteImport(source.importId, s.admin.id)
    await runCompleteImport(job)
    expect(job.status).toBe('succeeded')
    const imported = await getBackupSnapshot(source.importId)
    await previewCompleteRestore({ snapshotId: imported.id }, s.admin.id)
    await atomicJson(recordPath('snapshots', original.id), { ...original, manifest: { ...original.manifest, databaseVersion: '2.20.0' } })
    const historical = (await backupHistory()).snapshots.find(item => item.id === original.id)!
    expect(historical).toMatchObject({ restorable: false, compatibility: { status: 'unsupported', sourceVersion: '2.20.0', targetVersion: DATABASE_BACKUP_VERSION, reason: 'data-version' } })
    await expect(previewCompleteRestore({ snapshotId: original.id }, s.admin.id)).rejects.toMatchObject({ status: 400, data: { reason: 'BACKUP_UNSUPPORTED_FORMAT' } })
    const download = await downloadGet(request('download', { token: s.session.token }), context(original.id))
    expect(download.status).toBe(200); await download.body!.cancel()
    await expect.poll(() => sourceIsPinned(original.id)).toBe(false)
    await deleteBackupSnapshot(original.id)
  })
})

describe('administrator backup API boundaries', () => {
  it('requires an administrator session on every new endpoint and rejects non-administrators', async () => {
    const s = await seed(), id = randomUUID(), ctx = { params: Promise.resolve({}) }, idCtx = context(id)
    const calls = [
      settingsGet(request('settings'), ctx), settingsPut(request('settings', { method: 'PUT', body: {} }), ctx),
      historyGet(request('snapshots'), ctx), snapshotPost(request('snapshots', { method: 'POST', body: {} }), ctx),
      downloadGet(request('download'), idCtx), downloadHead(request('download', { method: 'HEAD' }), idCtx), uploadGet(request('imports'), idCtx), uploadPatch(request('imports', { method: 'PATCH' }), idCtx), uploadDelete(request('imports', { method: 'DELETE' }), idCtx), uploadCompletePost(request('imports/complete', { method: 'POST' }), idCtx), snapshotDelete(request('snapshot', { method: 'DELETE', body: {} }), idCtx),
      uploadPost(request('imports', { method: 'POST', body: {} }), ctx), previewPost(request('preview', { method: 'POST', body: {} }), ctx),
      importPost(request('snapshots/import', { method: 'POST', body: {} }), ctx),
      restorePost(request('restore', { method: 'POST', body: {} }), ctx), jobGet(request('job'), idCtx),
    ]
    expect((await Promise.all(calls)).map((response) => response.status)).toEqual(Array(16).fill(401))
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
  it('requires typed restore confirmation and blocks reset while a complete task is reserved', async () => {
    const s = await seed(), ctx = { params: Promise.resolve({}) }
    const response = await restorePost(request('restores', { method: 'POST', token: s.session.token, body: { previewId: randomUUID(), confirm: 'yes' } }), ctx)
    expect(response.status).toBe(400); expect(fixture.after).toHaveLength(0)
    const job = await queueCompleteBackup(s.admin.id)
    const responseWhileBusy = await resetPost(request('system-reset', { method: 'POST', token: s.session.token, body: { confirm: 'RESET_ALL_DATA' } }), ctx)
    expect(responseWhileBusy.status).toBe(409)
    releaseBackupJob(job.id)
    expect(await client.article.count()).toBe(1)
  })
})

describe('resumable backup HTTP protocol', () => {
  it('serves correct ranges, ETags, HEAD metadata and releases references after cancellation', async () => {
    const s = await seed(), complete = await snapshot(), ctx = context(complete.id)
    const file = await fs.readFile(artifactPath(complete.id)), etag = `"${complete.sha256}"`
    const download = (headers: Record<string,string>) => downloadGet(new NextRequest('http://localhost/download', { headers: { Cookie: `sv_session=${s.session.token}`, ...headers } }), ctx)
    const head = await downloadHead(request('download', { method: 'HEAD', token: s.session.token }), ctx)
    expect(head.status).toBe(200); expect(head.headers.get('etag')).toBe(etag)
    expect(head.headers.get('accept-ranges')).toBe('bytes'); expect(head.headers.get('content-length')).toBe(String(file.length))
    expect(await head.text()).toBe(''); expect(sourceIsPinned(complete.id)).toBe(false)
    const range = await download({ Range: 'bytes=10-99', 'If-Range': etag })
    expect(range.status).toBe(206); expect(range.headers.get('content-range')).toBe(`bytes 10-99/${file.length}`)
    expect(Buffer.from(await range.arrayBuffer())).toEqual(file.subarray(10,100))
    const suffix = await download({ Range: 'bytes=-32' })
    expect(suffix.status).toBe(206); expect(Buffer.from(await suffix.arrayBuffer())).toEqual(file.subarray(-32))
    const end = await download({ Range: `bytes=${file.length-7}-` })
    expect(Buffer.from(await end.arrayBuffer())).toEqual(file.subarray(-7))
    const unavailable = await download({ Range: `bytes=${file.length}-` })
    expect(unavailable.status).toBe(416); expect(unavailable.headers.get('content-range')).toBe(`bytes */${file.length}`)
    const changed = await download({ Range: 'bytes=0-5', 'If-Range': '"different"' })
    expect(changed.status).toBe(200); expect(Buffer.from(await changed.arrayBuffer())).toEqual(file)
    const multiple = await download({ Range: 'bytes=0-1,5-6' })
    expect(multiple.status).toBe(200); await multiple.body!.cancel()
    const canceled = await download({})
    expect(sourceIsPinned(complete.id)).toBe(true); await canceled.body!.cancel()
    await expect.poll(() => sourceIsPinned(complete.id)).toBe(false)
  })
  it('creates an upload by JSON, accepts binary slices, and queues preflight without blocking the request', async () => {
    const s = await seed(), complete = await snapshot(), bytes = await fs.readFile(artifactPath(complete.id)), ctx = { params: Promise.resolve({}) }
    const created = await uploadPost(request('imports', { token: s.session.token, method: 'POST', body: { size: bytes.length, fileName: 'backup.zip', lastModified: 0, fingerprint: digest(bytes) } }), ctx)
    expect(created.status).toBe(201)
    const session = (await created.json()).data
    const binary = new NextRequest('http://localhost/chunk', { method: 'PATCH', headers: { Cookie: `sv_session=${s.session.token}`, 'Content-Type': 'application/octet-stream', 'Upload-Offset': '0', 'X-Chunk-SHA256': digest(bytes) }, body: new Uint8Array(bytes) })
    const appended = await uploadPatch(binary, context(session.importId)); expect(appended.status).toBe(200)
    expect((await appended.json()).data.offset).toBe(bytes.length)
    expect((await uploadCompletePost(request('complete', { method: 'POST', token: s.session.token }), context(session.importId))).status).toBe(200)
    const accepted = await previewPost(request('preview', { method: 'POST', token: s.session.token, body: { importId: session.importId } }), ctx)
    expect(accepted.status).toBe(202)
    const job = (await accepted.json()).data; expect(job.kind).toBe('preview'); expect(job.status).toBe('queued')
    expect(fixture.after).toHaveLength(1); await fixture.after[0]()
    const finished = await getBackupJob(job.id)
    expect(finished.status).toBe('succeeded'); expect(finished.preview?.manifest.formatVersion).toBe(2)
    expect(finished.progress?.processedRecords).toBeGreaterThan(0)
  })
  it('keeps old snapshot artifacts and omits file inventories from history', async () => {
    await seed(); const complete = await snapshot()
    await atomicJson(recordPath('snapshots',complete.id), { ...complete, manifest: { formatVersion: 1, counts: { users: 2 }, files: [{ path: 'old', size: 4, sha256: 'a'.repeat(64) }] } })
    const history = await backupHistory()
    expect(history.snapshots[0].restorable).toBe(false)
    expect(history.snapshots[0].manifest.fileCount).toBe(1)
    expect(history.snapshots[0].manifest).not.toHaveProperty('files')
    expect((await fs.stat(artifactPath(complete.id))).size).toBe(complete.size)
  })
})
