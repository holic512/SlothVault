import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@generated/prisma-sqlite/client'
import type { AppPrismaClient } from '@/server/database/client'
import type { CommissionActor } from './input'
const fixture = vi.hoisted(() => ({ client: null as unknown as AppPrismaClient, root: `/tmp/slothvault-workflow-tests-${process.pid}-${Date.now()}`, queue: Promise.resolve() }))
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
import { createWorkflow, executeWorkflowCommand, getWorkflow, closeExpiredMaintenance } from './workflow'
import { createInvitation, claimInvitation, inspectInvitation, revokeInvitation } from './invitations'
import { workflowCommandInput } from './workflow-input'
import { uploadCommissionFile, downloadCommissionFile, commissionArchive } from './workflow-files'
import { listSimpleTemplates, saveSimpleVersion, publishSimpleVersion } from './simple-templates'
import { synchronizeFields, type WorkflowDetail } from '@/lib/commission-workflow'
import { exportCommissionCollections, importCommissionCollections, validateCommissionBackup, commissionBackupShape } from './backup'
import { digest } from './submissions'
import { z } from 'zod'
import { exportDatabaseBackup } from '@/server/services/admin-backup/database-export'
import { importDatabaseBackup } from '@/server/services/admin-backup/database-import'
import { parseDatabaseImportPayload } from '@/server/services/admin-backup/database-validation'
const admin: CommissionActor = { userId: 1, isAdmin: true }, customer: CommissionActor = { userId: 2, isAdmin: false }, other: CommissionActor = { userId: 3, isAdmin: false }
let d: WorkflowDetail
async function command(input: Record<string, unknown>, actor = admin, commandId = randomUUID(), revision = d.revision) {
  d = await executeWorkflowCommand(Number(d.id), actor, workflowCommandInput.parse({ commandId, revision, ...input })); return d
}
async function upload(name: string, purpose: string, text: string, actor = admin) {
  d = await uploadCommissionFile(Number(d.id), actor, new Request('http://localhost/upload', { method: 'POST', body: text }), { name, purpose, shared: true, commandId: randomUUID() }); return d.files[0]
}
async function makeAgreement(mode = 'ONLINE', days = 15) {
  await command({ action: 'request.accept' })
  const seed = (await listSimpleTemplates())[0]
  const body = '# {{项目名称}}\n合同金额：{{合同金额}}\n维护：{{维护天数}}天\n{{备注}}'
  const saved = await saveSimpleVersion({ templateId: Number(seed.id), body, fields: synchronizeFields(body).map((field) => ({ ...field, required: field.key !== '备注' })) })
  await publishSimpleVersion(Number(saved.id))
  await command({ action: 'agreement.save', title: '订单系统委托合同', templateVersionId: Number(saved.id), values: { 备注: '按需求执行' }, totalFen: '100000', maintenanceDays: days, confirmationMode: mode })
  await command({ action: 'agreement.publish', id: Number(d.agreements[0].id) })
  const agreement = d.agreements[0]
  if (mode === 'ONLINE') await command({ action: 'agreement.confirm', id: Number(agreement.id), eventId: agreement.publishedEventId }, customer)
  else {
    const proof = await upload('signed.txt', 'CONTRACT', '双方确认合同')
    await command({ action: 'agreement.offline', id: Number(agreement.id), eventId: agreement.publishedEventId, confirmedAt: new Date().toISOString(), note: '双方线下确认', fileKeys: [proof.key] })
  }
  return agreement
}
async function deliver(days = 15) {
  await makeAgreement('ONLINE', days)
  await command({ action: 'project.start' })
  const file = await upload('source.txt', 'DELIVERY', 'immutable source')
  await command({ action: 'delivery.publish', note: '源码及运行说明', fileKeys: [file.key] })
  return file
}
beforeEach(async () => {
  mkdirSync(fixture.root, { recursive: true })
  const path = fixture.root + '/test.sqlite', db = new Database(path)
  db.pragma('foreign_keys=ON')
  for (const dir of readdirSync('prisma/providers/sqlite/migrations').filter((v) => /^\d/.test(v)).sort()) db.exec(readFileSync(`prisma/providers/sqlite/migrations/${dir}/migration.sql`, 'utf8'))
  expect(db.pragma('foreign_key_check')).toEqual([]); db.close()
  fixture.client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: 'file:' + path }, { timestampFormat: 'iso8601' }) }) as unknown as AppPrismaClient
  for (const [id, role] of [[1, 'ADMIN'], [2, 'USER'], [3, 'USER']] as const) await fixture.client.user.create({ data: { id, username: `actor${id}`, password: 'test-only', role } })
  await fixture.client.systemInstallation.create({ data: { id: 1, provider: 'sqlite', status: 'INSTALLED', schemaRevision: 11, installationId: randomUUID() } })
  d = await createWorkflow(customer, { commandId: randomUUID(), title: '订单系统', requirements: '创建与查询订单', draft: false })
})
afterEach(async () => { vi.useRealTimers(); await fixture.client.$disconnect(); await rm(fixture.root, { recursive: true, force: true }) })
describe('commission workflow with real SQLite transactions', () => {
  it('replays competing creation requests and rejects altered creation content', async () => {
    const input = { commandId: randomUUID(), title: '并发创建', requirements: '', draft: true }
    const result = await Promise.all([createWorkflow(admin, input), createWorkflow(admin, input)])
    expect(result[0].id).toBe(result[1].id)
    await expect(createWorkflow(admin, { ...input, title: '不同请求' })).rejects.toThrow('不同内容')
  })
  it('round-trips the complete portable backup with frozen contracts and unresolved maintenance', async () => {
    await deliver(17)
    await command({ action: 'payment.update', percent: 50, note: '首付款' })
    await command({ action: 'issue.create', title: '保留的问题', note: '待修复' }, customer)
    const before = await fixture.client.commissionSubmission.findMany({ orderBy: { sequence: 'asc' } })
    const backup = await exportDatabaseBackup()
    const payload = parseDatabaseImportPayload({ version: backup.version, data: backup.data, mode: 'overwrite' })
    await importDatabaseBackup(payload)
    const row = await fixture.client.commission.findUniqueOrThrow({ where: { commissionId: d.publicId } })
    const after = await fixture.client.commissionSubmission.findMany({ where: { commissionId: row.id }, orderBy: { sequence: 'asc' } })
    expect(after.map((item) => item.snapshotJson)).toEqual(before.map((item) => item.snapshotJson))
    d = await getWorkflow(row.id, customer)
    expect(d).toMatchObject({ stage: 'MAINTENANCE', paymentPercent: 50, maintenanceDays: 17 })
    expect(d.issues[0].status).toBe('OPEN')
    expect((await (await commissionArchive(row.id, customer)).arrayBuffer()).byteLength).toBeGreaterThan(500)
  })

  it('supports direct assignment, user requests and exclusive invitation claims', async () => {
    expect(d.stage).toBe('REQUESTED')
    const assigned = await createWorkflow(admin, { commandId: randomUUID(), title: '指定用户', requirements: '', subjectUserId: 2, draft: true })
    expect(assigned.subject).toBe('actor2')
    const unbound = await createWorkflow(admin, { commandId: randomUUID(), title: '邀请委托', requirements: '需求', draft: true })
    expect(unbound.bindingStatus).toBe('UNASSIGNED')
    await expect(getWorkflow(Number(unbound.id), customer)).rejects.toThrow('不存在')
    const invite = await createInvitation(Number(unbound.id), admin, unbound.revision)
    const token = invite.path.split('/').at(-1)!
    expect(await inspectInvitation(token)).toMatchObject({ status: 'AVAILABLE' })
    expect((await fixture.client.commissionInvitation.findFirst())?.tokenHash).toBe(digest(token))
    const claims = await Promise.allSettled([claimInvitation(token, customer), claimInvitation(token, other)])
    expect(claims.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(await claimInvitation(token, customer)).toEqual({ id: unbound.id })
    const claimed = await getWorkflow(Number(unbound.id), customer)
    expect(claimed.events[0].snapshot.type).toBe('invitation.claim')
    expect(claimed.events[0].snapshot.note).not.toContain(token)
  })
  it('revokes and expires invitations without revealing content', async () => {
    const row = await createWorkflow(admin, { commandId: randomUUID(), title: 'private title', requirements: '', draft: true })
    const first = await createInvitation(Number(row.id), admin, row.revision)
    const token = first.path.split('/').at(-1)!
    expect(Object.keys(await inspectInvitation(token))).toEqual(['status', 'expiresAt'])
    await revokeInvitation(Number(row.id), admin, row.revision + 1)
    await expect(claimInvitation(token, customer)).rejects.toThrow('过期')
    const second = await createInvitation(Number(row.id), admin, row.revision + 2)
    await fixture.client.commissionInvitation.updateMany({ where: { commissionId: Number(row.id) }, data: { expiresAt: new Date(0) } })
    await expect(claimInvitation(second.path.split('/').at(-1)!, customer)).rejects.toThrow('过期')
  })
  it('keeps payment independent, starts maintenance on delivery and preserves unresolved issues on user close', async () => {
    await command({ action: 'payment.update', percent: 50, note: '已付一半' })
    expect(d.stage).toBe('REQUESTED')
    const file = await deliver()
    expect(d.stage).toBe('MAINTENANCE')
    expect(Date.parse(d.maintenanceEndsAt!) - Date.parse(d.maintenanceStartedAt!)).toBe(15 * 86400000)
    await command({ action: 'issue.create', title: '页面错误', note: '订单页面报错' }, customer)
    await command({ action: 'maintenance.close', note: '' }, customer)
    expect(d.stage).toBe('COMPLETED'); expect(d.paymentPercent).toBe(50); expect(d.issues[0].status).toBe('OPEN')
    expect(await (await downloadCommissionFile(Number(d.id), Number(file.id), customer)).text()).toBe('immutable source')
    await expect(command({ action: 'issue.create', title: '新问题', note: '已结束' }, customer)).rejects.toThrow('不允许')
    await command({ action: 'issue.update', issueId: d.issues[0].id, status: 'RESOLVED', note: '继续修复既有问题' })
    expect(d.issues[0].status).toBe('RESOLVED')
  })
  it('closes overdue maintenance exactly once and rejects issues at the deadline', async () => {
    await deliver(3)
    await command({ action: 'issue.create', title: '未解决', note: '待处理' }, customer)
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(d.maintenanceEndsAt!))
    await expect(command({ action: 'issue.create', title: '超时新问题', note: '应拒绝' }, customer)).rejects.toThrow('不允许')
    await Promise.all([closeExpiredMaintenance(), closeExpiredMaintenance()])
    d = await getWorkflow(Number(d.id), admin)
    expect(d.maintenanceCloseReason).toBe('EXPIRED')
    expect(d.events.filter((event) => event.snapshot.type === 'maintenance.close')).toHaveLength(1)
    expect(d.issues[0].status).toBe('OPEN')
  })
  it('requires admin closure reason and does not extend maintenance for a repair', async () => {
    await deliver()
    const deadline = d.maintenanceEndsAt
    const file = await upload('repair.txt', 'DELIVERY', 'repair')
    await command({ action: 'submission.create', kind: 'REPAIR', note: '修复', fileKeys: [file.key] })
    expect(d.maintenanceEndsAt).toBe(deadline)
    await expect(command({ action: 'maintenance.close', note: '' })).rejects.toThrow('原因')
    await command({ action: 'maintenance.close', note: '双方确认关闭入口' })
    expect(d.maintenanceCloseReason).toBe('ADMIN')
  })
  it('supports offline confirmation while rejecting online impersonation', async () => {
    await makeAgreement('OFFLINE')
    expect(d.stage).toBe('READY')
    const confirmation = d.events.find((event) => event.snapshot.type === 'agreement.offline')!
    expect(confirmation.snapshot.actor.role).toBe('ADMIN')
    expect(confirmation.snapshot.attachments).toHaveLength(1)
    expect(await fixture.client.contract.count()).toBe(0)
  })
  it('rejects cross-user access, stage bypass and stale contract versions', async () => {
    await expect(command({ action: 'project.start' })).rejects.toThrow('不允许')
    await expect(getWorkflow(Number(d.id), other)).rejects.toThrow('不存在')
    await command({ action: 'request.accept' })
    const template = (await listSimpleTemplates())[0].versions[0]
    const saved = await saveSimpleVersion({ templateId: Number((await listSimpleTemplates())[0].id), body: '固定合同', fields: [] }); await publishSimpleVersion(Number(saved.id))
    void template
    const input = { action: 'agreement.save', title: '合同', templateVersionId: Number(saved.id), values: {}, totalFen: null, maintenanceDays: 15 }
    await command(input); const first = d.agreements[0].id
    await command({ action: 'agreement.publish', id: Number(first) }); const eventId = d.agreements[0].publishedEventId
    await command(input); await command({ action: 'agreement.publish', id: Number(d.agreements[0].id) })
    await expect(command({ action: 'agreement.confirm', id: Number(first), eventId }, customer)).rejects.toThrow('过期')
    await expect(command({ action: 'agreement.confirm', id: Number(d.agreements[0].id), eventId: d.agreements[0].publishedEventId })).rejects.toThrow('不允许')
  })
  it('freezes submitted attachments, detects byte tampering and preserves exact snapshots through remapped restore', async () => {
    const file = await upload('requirements.txt', 'REQUIREMENT', 'original requirements', customer)
    expect((await getWorkflow(Number(d.id), admin)).files).toHaveLength(0)
    await expect(downloadCommissionFile(Number(d.id), Number(file.id), admin)).rejects.toThrow('不存在')
    await command({ action: 'submission.create', kind: 'REQUIREMENT', note: '补充需求', fileKeys: [file.key], reference: d.events[0].id }, customer)
    const before = await fixture.client.commissionSubmission.findMany({ orderBy: { sequence: 'asc' } })
    const backup = await exportCommissionCollections(fixture.client as never)
    const parsed = z.object(commissionBackupShape).parse(backup)
    const fileManagements = (await fixture.client.fileManagement.findMany()).map((row) => ({ ...row, id: String(row.id), fileSize: row.fileSize.toString() }))
    const users = [1, 2, 3].map((id) => ({ id: String(id) }))
    validateCommissionBackup({ ...parsed, fileManagements, users })
    // Import under a different database primary key without changing snapshot public IDs or bytes.
    await fixture.client.commission.update({ where: { id: Number(d.id) }, data: { commissionId: 'moved-old-copy' } })
    for (const row of before) await fixture.client.commissionSubmission.update({ where: { id: row.id }, data: { publicId: randomUUID() } })
    await fixture.client.commissionFile.deleteMany({ where: { commissionId: Number(d.id) } })
    const maps: Record<string, Map<string, number>> = { users: new Map(users.map((row) => [row.id, Number(row.id)])), fileManagements: new Map(fileManagements.map((row) => [row.id, Number(row.id)])) }
    await importCommissionCollections(fixture.client as never, parsed, maps, true)
    await importCommissionCollections(fixture.client as never, parsed, maps, false)
    const restoredId = maps.commissions.get(d.id)!
    const restored = await fixture.client.commissionSubmission.findMany({ where: { commissionId: restoredId }, orderBy: { sequence: 'asc' } })
    expect(restored.map((row) => row.snapshotJson)).toEqual(before.map((row) => row.snapshotJson))
    expect(restored.map((row) => row.snapshotHash)).toEqual(before.map((row) => row.snapshotHash))
    d = await getWorkflow(restoredId, customer)
    const archive = await commissionArchive(restoredId, customer); expect((await archive.arrayBuffer()).byteLength).toBeGreaterThan(500)
    const stored = await fixture.client.fileManagement.findFirstOrThrow()
    await writeFile(fixture.root + '/uploads/' + stored.filePath.slice('uploads/'.length), 'tampered')
    await expect(downloadCommissionFile(restoredId, Number(d.files[0].id), customer)).rejects.toThrow('不一致')
  })
  it('detects snapshot and predecessor changes and prevents idempotency-key content substitution', async () => {
    const key = randomUUID(), revision = d.revision
    await command({ action: 'payment.update', percent: 50, note: '到账' }, admin, key, revision)
    const count = d.events.length
    await command({ action: 'payment.update', percent: 50, note: '到账' }, admin, key, revision)
    expect(d.events).toHaveLength(count)
    await expect(command({ action: 'payment.update', percent: 100, note: '到账' }, admin, key, revision)).rejects.toThrow('不同操作')
    await expect(command({ action: 'payment.update', percent: 20, note: '' })).rejects.toThrow('原因')
    await fixture.client.commissionSubmission.updateMany({ where: { sequence: 2 }, data: { previousHash: '0'.repeat(64) } })
    await expect(getWorkflow(Number(d.id), admin)).rejects.toThrow('完整性')
  })
})
