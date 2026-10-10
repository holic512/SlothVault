import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@generated/prisma-sqlite/client'
import type { AppPrismaClient } from '@/server/database/client'
import type { CommissionActor, CommissionCommand } from './input'
const fixture = vi.hoisted(() => ({ client: null as unknown as AppPrismaClient, root: `/tmp/slothvault-commissions-tests-${process.pid}-${Date.now()}`, queue: Promise.resolve() }))
vi.mock('next/cache', async (load) => ({ ...await load<typeof import('next/cache')>(), revalidateTag: vi.fn() }))
vi.mock('@/server/database/client', () => ({ configuredDatabaseProvider: () => 'sqlite', databaseSnapshotIsolationLevel: () => undefined }))
vi.mock('@/server/prisma', () => ({ prisma: new Proxy({}, { get: (_target, key) => { const v = Reflect.get(fixture.client, key, fixture.client); return typeof v === 'function' ? v.bind(fixture.client) : v } }) }))
vi.mock('@/server/database/unit-of-work', () => ({ unitOfWork: { execute: async (fn: Parameters<AppPrismaClient['$transaction']>[0]) => {
  const previous = fixture.queue
  let release!: () => void
  fixture.queue = new Promise<void>((resolve) => { release = resolve })
  await previous
  try { return await fixture.client.$transaction(fn as never, { timeout: 30000 }) } finally { release() }
} } }))
vi.mock('@/server/services/admin-files', async (load) => ({ ...await load<typeof import('@/server/services/admin-files')>(), UPLOAD_ROOT: fixture.root + '/uploads' }))
import { createCommission, executeCommissionCommand, getCommission, getCommissionSettings, saveCommissionSettings } from './service'
import { assertDocumentSnapshot, createCommissionDocument } from './documents'
import { listContractTemplates } from './templates'
import { uploadCommissionFile, downloadCommissionFile } from './files'
import { upgradeCommissionLifecycle } from './upgrade'
import { exportDatabaseBackup, importDatabaseBackup, parseDatabaseImportPayload } from '@/server/services/admin-backup'
import { completeAgreementValues, seedSignedLegacyContract } from './test-fixtures'
import type { CommissionDetail } from '@/types/commissions'
const admin: CommissionActor = { userId: 1, isAdmin: true, sessionId: '00000000-0000-4000-8000-000000000001' }, customer: CommissionActor = { userId: 2, isAdmin: false }, other: CommissionActor = { userId: 3, isAdmin: false }
let d: CommissionDetail
async function command(input: Record<string, unknown>, actor = admin, commandId = randomUUID()) {
  d = await executeCommissionCommand(Number(d.id), actor, { ...input, commandId, revision: d.revision } as CommissionCommand); return d
}
async function draft(kind: 'AGREEMENT' | 'CHANGE' | 'ACCEPTANCE', sourceId?: string, values: Record<string, unknown> = {}) {
  const template = (await listContractTemplates())[0].versions.find((v) => v.status === 'PUBLISHED')!
  d = await createCommissionDocument(Number(d.id), admin, { commandId: randomUUID(), revision: d.revision, templateVersionId: Number(template.id), documentType: kind, sourceRecordId: sourceId ? Number(sourceId) : undefined, values: kind === 'AGREEMENT' ? { ...completeAgreementValues(), ...values } : values })
  return d.documents[0]
}
async function seedSignedHistory(id: string) {
  await seedSignedLegacyContract(fixture.client, Number(id))
  d = await getCommission(Number(d.id), admin)
}
async function upload(name: string, purpose: string, content: string, actor = admin, shared = false, commandId = randomUUID()) {
  d = await uploadCommissionFile(Number(d.id), actor, new Request('http://localhost/upload', { method: 'POST', body: content }), { name, purpose, shared, commandId }); return d.files[0]
}
beforeEach(async () => {
  mkdirSync(fixture.root, { recursive: true })
  const path = fixture.root + '/test.sqlite', db = new Database(path)
  db.pragma('foreign_keys=ON')
  for (const dir of readdirSync('prisma/providers/sqlite/migrations').filter((v) => /^\d/.test(v)).sort()) db.exec(readFileSync(`prisma/providers/sqlite/migrations/${dir}/migration.sql`, 'utf8'))
  expect(db.pragma('foreign_key_check')).toEqual([]); db.close()
  fixture.client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: 'file:' + path }, { timestampFormat: 'iso8601' }) }) as unknown as AppPrismaClient
  for (const [id, role] of [[1, 'ADMIN'], [2, 'USER'], [3, 'USER']] as const) await fixture.client.user.create({ data: { id, username: `actor${id}`, password: 'test-only-hash', role } })
  await fixture.client.systemInstallation.create({ data: { id: 1, provider: 'sqlite', status: 'INSTALLED', schemaRevision: 10, installationId: randomUUID() } })
  d = await createCommission(customer, { commandId: randomUUID(), title: '订单管理定制', purpose: '内部业务流程', requirements: '订单新增、查询、取消与数据导出' })
})
afterEach(async () => { vi.useRealTimers(); await fixture.client.$disconnect(); await rm(fixture.root, { recursive: true, force: true }) })
describe('private commission lifecycle with real SQLite transactions', () => {
  it('guards actor boundaries, revision races and manual stage jumps without inventing facts', async () => {
    await expect(getCommission(Number(d.id), other)).rejects.toMatchObject({ status: 404 })
    await expect(command({ action: 'stage', stage: 'DEVELOPMENT', progress: 10, note: '', reason: 'test' }, customer)).rejects.toMatchObject({ status: 403 })
    await expect(command({ action: 'stage', stage: 'DEVELOPMENT', progress: 10, note: '', reason: '' })).rejects.toMatchObject({ status: 400 })
    const revision = d.revision
    const outcomes = await Promise.allSettled([executeCommissionCommand(Number(d.id), admin, { action: 'stage', stage: 'DEVELOPMENT', progress: 10, note: '', reason: '按实际沟通提前开发', revision, commandId: randomUUID() }), executeCommissionCommand(Number(d.id), admin, { action: 'stage', stage: 'DELIVERY', progress: 20, note: '', reason: '并发更新', revision, commandId: randomUUID() })])
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    d = await getCommission(Number(d.id), admin); expect(d.payments).toEqual([]); expect(d.documents).toEqual([])
  })
  it('forces delivery privacy, supports upload retries and rejects tiny masquerading ZIPs', async () => {
    const key = randomUUID(), file = await upload('private.txt', 'DELIVERY', 'private', admin, true, key)
    expect(file.shared).toBe(false)
    await upload('private.txt', 'DELIVERY', 'private', admin, true, key); expect(d.files).toHaveLength(1)
    const customerView = await getCommission(Number(d.id), customer); expect(customerView.files).toEqual([]); expect(JSON.stringify(customerView.events)).not.toContain('private.txt')
    await expect(upload('bad.zip', 'DELIVERY', 'x')).rejects.toMatchObject({ status: 400 })
  })
  it('preserves legacy contracts on every startup and seeds the current template', async () => {
    await draft('AGREEMENT')
    await fixture.client.contract.create({ data: { contractId: randomUUID(), issuerUserId: 1, subjectUserId: 2, title: '旧合同', body: 'legacy', bodyHash: 'a'.repeat(64), partyCommitment: 'b'.repeat(64) } })
    await upgradeCommissionLifecycle(fixture.client)
    expect(await fixture.client.contract.count({ where: { commissionId: null } })).toBe(1)
    expect(await fixture.client.contract.count({ where: { commissionId: Number(d.id) } })).toBe(1)
    await fixture.client.contract.create({ data: { contractId: randomUUID(), issuerUserId: 1, subjectUserId: 2, title: 'repeat guard', body: 'legacy', bodyHash: 'a'.repeat(64), partyCommitment: 'b'.repeat(64) } })
    await upgradeCommissionLifecycle(fixture.client); expect(await fixture.client.contract.count()).toBe(3)
    expect(await fixture.client.contractTemplate.count({ where: { key: 'commission-markdown-v2' } })).toBe(1)
  })
  it('round-trips business data with remapped IDs and ignores broken legacy contract collections', async () => {
    await seedSignedHistory((await draft('AGREEMENT')).id)
    await upload('source.txt', 'DELIVERY', 'archive bytes')
    await command({ action: 'delivery.create', version: 'v1', kind: 'FINAL', note: '', testInstructions: '运行应用', items: [{ fileId: Number(d.files[0].id), label: '源码', versionNote: 'v1' }] })
    await command({ action: 'delivery.publish', id: Number(d.deliveries[0].id) })
    await saveCommissionSettings({ provider: { Name: '开发方' }, calendar: { holidays: ['2026-10-09'], workdays: [] } }); expect((await getCommissionSettings()).provider.Name).toBe('开发方')
    const backup = await exportDatabaseBackup(); expect(backup.version).toBe('2.12.0')
    const payload = parseDatabaseImportPayload({ version: backup.version, data: backup.data, mode: 'overwrite' })
    await importDatabaseBackup(payload)
    const restored = await fixture.client.commission.findUniqueOrThrow({ where: { commissionId: d.commissionId } }); expect(restored.id).not.toBe(Number(d.id))
    const detail = await getCommission(restored.id, admin); expect(detail.documents[0].bodyHash).toBe(d.documents[0].bodyHash)
    expect(await (await downloadCommissionFile(restored.id, Number(detail.files[0].id), customer)).text()).toBe('archive bytes')
    const legacy = parseDatabaseImportPayload({ version: '2.8.0', data: { ...backup.data, commissionTemplates: [], commissionTemplateVersions: [], commissionSettings: [], commissions: [], commissionMilestones: [], commissionPlans: [], commissionFiles: [], commissionChanges: [], commissionDeliveries: [], commissionDeliveryItems: [], commissionPayments: [], commissionIssues: [], commissionAcceptances: [], commissionEvents: [], contracts: [{ malformed: true }], contractCredentials: [{ malformed: true }] } })
    expect(legacy.ignoredLegacyContracts).toBe(1); expect(legacy.data.contracts).toEqual([])
  })
  it('rejects byte drift and published manifest edits, while allowing draft correction', async () => {
    const f = await upload('version.txt', 'DELIVERY', 'original')
    await command({ action: 'delivery.create', version: 'v1', kind: 'FINAL', note: '', testInstructions: 'run', items: [{ fileId: Number(f.id), label: '源码', versionNote: 'v1' }] })
    const id = Number(d.deliveries[0].id)
    await command({ action: 'delivery.update', id, version: 'v1-fixed', kind: 'FINAL', note: '补充说明', testInstructions: 'run', items: [{ fileId: Number(f.id), label: '源码及说明', versionNote: 'v1' }] })
    const metadata = await fixture.client.commissionFile.findUniqueOrThrow({ where: { id: Number(f.id) }, include: { file: true } })
    const path = fixture.root + '/' + metadata.file.filePath
    await writeFile(path, 'modified')
    await expect(command({ action: 'delivery.publish', id })).rejects.toMatchObject({ status: 409 })
    await writeFile(path, 'original'); await command({ action: 'delivery.publish', id })
    await expect(command({ action: 'delivery.update', id, version: 'overwrite', kind: 'FINAL', note: '', testInstructions: 'run', items: [{ fileId: Number(f.id), label: 'overwrite', versionNote: 'v2' }] })).rejects.toMatchObject({ status: 409 })
    await fixture.client.commissionDeliveryItem.update({ where: { id: Number(d.deliveries[0].items[0].id) }, data: { label: 'tampered' } })
    await expect(getCommission(Number(d.id), customer)).rejects.toMatchObject({ status: 409 })
  })
  it('enforces purpose upload limits before writing oversized files', async () => {
    await expect(uploadCommissionFile(Number(d.id), customer, new Request('http://localhost/upload', { method: 'POST', body: 'proof', headers: { 'content-length': String(10 * 1024 * 1024 + 1) } }), { name: 'proof.txt', purpose: 'PAYMENT', shared: true, commandId: randomUUID() })).rejects.toMatchObject({ status: 413 })
    await expect(uploadCommissionFile(Number(d.id), admin, new Request('http://localhost/upload', { method: 'POST', body: 'source', headers: { 'content-length': String(100 * 1024 * 1024 + 1) } }), { name: 'source.zip', purpose: 'DELIVERY', shared: false, commandId: randomUUID() })).rejects.toMatchObject({ status: 413 })
    expect(await fixture.client.commissionFile.count()).toBe(0)
  })
  it('rejects backup files from another customer and preserves the signed snapshot root after restore', async () => {
    await seedSignedHistory((await draft('AGREEMENT')).id)
    const owned = await upload('one.txt', 'TEST', 'one', customer)
    const second = await createCommission(other, { commandId: randomUUID(), title: '另一个客户', purpose: '独立用途', requirements: '独立需求' })
    const backup = await exportDatabaseBackup(), data = structuredClone(backup.data)
    data.commissionIssues.push({ id: '1000', commissionId: second.id, deliveryId: null, createdById: '3', title: '跨项目引用', kind: 'BUG', severity: 'GENERAL', status: 'OPEN', steps: 'step', expected: 'expected', actual: 'actual', resolution: '', fileIdsJson: JSON.stringify([Number(owned.id)]), dueAt: null, createdAt: new Date().toISOString(), resolvedAt: null })
    expect(() => parseDatabaseImportPayload({ version: '2.9.0', data })).toThrow('boundaries')
    const stored = await fixture.client.contract.findUniqueOrThrow({ where: { id: Number(d.documents[0].id) } }), modified = structuredClone(backup.data)
    modified.contracts[0].snapshotJson += ' '
    expect(() => parseDatabaseImportPayload({ version: '2.9.0', data: modified })).toThrow('快照校验失败')
    const parsed = parseDatabaseImportPayload({ version: '2.9.0', data: backup.data, mode: 'overwrite' })
    await importDatabaseBackup(parsed)
    const restored = await fixture.client.contract.findUniqueOrThrow({ where: { contractId: stored.contractId } })
    expect(restored.contractHash).toBe(stored.contractHash); expect(restored.snapshotHash).toBe(stored.snapshotHash)
    expect(() => assertDocumentSnapshot(restored, true)).not.toThrow()
  })

})
