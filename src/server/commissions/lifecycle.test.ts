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
vi.mock('@/server/database/client', () => ({ databaseSnapshotIsolationLevel: () => undefined }))
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
import { assertDocumentSnapshot, createCommissionDocument, documentSnapshotHash } from './documents'
import { listContractTemplates, saveTemplateVersion, publishTemplateVersion } from './templates'
import { signUserContract, issueAdminContract, declineUserContract, cancelAdminContract } from '@/server/services/contracts'
import { uploadCommissionFile, downloadCommissionFile, commissionArchive } from './files'
import { upgradeCommissionLifecycle } from './upgrade'
import { exportDatabaseBackup, importDatabaseBackup, parseDatabaseImportPayload } from '@/server/services/admin-backup'
import { addWorkingDays } from '@/lib/commissions'
import { completeAgreementValues } from './test-fixtures'
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
async function issueAndSign(id: string) {
  await issueAdminContract({ id: Number(id), issuerUserId: 1, sessionId: '00000000-0000-4000-8000-000000000001' })
  await signUserContract({ id: Number(id), userId: 2, sessionId: '00000000-0000-4000-8000-000000000002', ip: '127.0.0.1', userAgent: 'lifecycle-test' })
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
  it('completes agreement, receipts, progress, confirmed change, acceptance, delivery and maintenance', async () => {
    const agreement = await draft('AGREEMENT'); await issueAndSign(agreement.id)
    expect(d.plans.map((p) => p.amountFen)).toEqual(['30000', '40000', '30001'])
    const proof = await upload('transfer.txt', 'PAYMENT', 'bank transfer proof', customer)
    await command({ action: 'payment.submit', planId: Number(d.plans[0].id), amountFen: '10000', note: '首笔转账', evidenceFileId: Number(proof.id) }, customer)
    expect(d.plans[0]).toMatchObject({ status: 'PENDING', netFen: '0' })
    const paymentId = Number(d.payments[0].id), key = randomUUID(), oldRevision = d.revision
    await command({ action: 'payment.review', id: paymentId, approve: true, note: '核实首笔到账' }, admin, key)
    const repeat = await executeCommissionCommand(Number(d.id), admin, { action: 'payment.review', id: paymentId, approve: true, note: '核实首笔到账', commandId: key, revision: oldRevision })
    expect(repeat.plans[0].netFen).toBe('10000'); expect(repeat.plans[0].status).toBe('PARTIAL')
    await command({ action: 'payment.record', planId: Number(d.plans[0].id), amountFen: '20000', kind: 'RECEIPT', note: '第二笔已到账' })
    await command({ action: 'stage', stage: 'DEVELOPMENT', progress: 35, note: '订单核心流程完成', reason: '首款到账后安排开发' })
    expect(d.paymentSummary).toContain('已付首款')
    await command({ action: 'payment.record', planId: Number(d.plans[1].id), amountFen: '40000', kind: 'RECEIPT', note: '阶段成果款已到账' })
    await command({ action: 'change.create', title: '增加导出', original: '查询列表', proposed: '增加 XLSX 导出', reason: '运营需要' }, customer)
    await command({ action: 'change.quote', id: Number(d.changes[0].id), feeFen: '5000', extensionDays: 2, impact: '增加导出接口' })
    const change = await draft('CHANGE', d.changes[0].id); await issueAndSign(change.id)
    expect(d.totalFen).toBe('105001'); expect(d.plans.at(-1)?.amountFen).toBe('5000')
    const artifact = await upload('source.txt', 'DELIVERY', 'immutable source version')
    await command({ action: 'delivery.create', version: 'v1', kind: 'FINAL', note: '完整源码与运行说明', testInstructions: '启动项目并执行订单验收', items: [{ fileId: Number(artifact.id), label: '源码', versionNote: 'commit-1' }] })
    const deliveryId = Number(d.deliveries[0].id)
    await expect(downloadCommissionFile(Number(d.id), Number(artifact.id), customer)).rejects.toMatchObject({ status: 404 })
    await command({ action: 'delivery.publish', id: deliveryId })
    expect(await (await downloadCommissionFile(Number(d.id), Number(artifact.id), customer)).text()).toBe('immutable source version')
    await command({ action: 'acceptance.create', deliveryId, result: 'CONDITIONAL', basis: '订单全流程通过', outstanding: '轻微文字问题于三日内修复' }, customer)
    const acceptance = await draft('ACCEPTANCE', d.acceptances[0].id); await issueAndSign(acceptance.id)
    expect(d.acceptances[0]).toMatchObject({ result: 'CONDITIONAL', status: 'CONFIRMED' }); expect(d.maintenanceUntil).not.toBeNull()
    await command({ action: 'payment.record', planId: Number(d.plans[2].id), amountFen: '30001', kind: 'RECEIPT', note: '尾款已收' })
    await command({ action: 'payment.record', planId: Number(d.plans[3].id), amountFen: '5000', kind: 'RECEIPT', note: '变更款已收' })
    await command({ action: 'delivery.receive', id: deliveryId, received: true, note: '源码与说明均已收到' }, customer)
    await command({ action: 'stage', stage: 'COMPLETED', progress: 100, note: '交付完成，继续履行维护', reason: '客户已验收并接收' })
    expect(d.paymentSummary).toBe('已结清'); expect(d.warnings).toContain('项目阶段已完成，免费维护期限仍在履行中')
    const zip = await commissionArchive(Number(d.id), customer)
    expect(Buffer.from(await zip.arrayBuffer()).subarray(0, 2).toString()).toBe('PK')
    expect(await fixture.client.commissionEvent.count({ where: { commissionId: Number(d.id) } })).toBeGreaterThan(15)
  })
  it('guards actor boundaries, revision races and manual stage jumps without inventing facts', async () => {
    await expect(getCommission(Number(d.id), other)).rejects.toMatchObject({ status: 404 })
    await expect(command({ action: 'stage', stage: 'DEVELOPMENT', progress: 10, note: '', reason: 'test' }, customer)).rejects.toMatchObject({ status: 403 })
    await expect(command({ action: 'stage', stage: 'DEVELOPMENT', progress: 10, note: '', reason: '' })).rejects.toMatchObject({ status: 400 })
    const revision = d.revision
    const outcomes = await Promise.allSettled([executeCommissionCommand(Number(d.id), admin, { action: 'stage', stage: 'DEVELOPMENT', progress: 10, note: '', reason: '按实际沟通提前开发', revision, commandId: randomUUID() }), executeCommissionCommand(Number(d.id), admin, { action: 'stage', stage: 'DELIVERY', progress: 20, note: '', reason: '并发更新', revision, commandId: randomUUID() })])
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    d = await getCommission(Number(d.id), admin); expect(d.payments).toEqual([]); expect(d.documents).toEqual([])
  })
  it('keeps rejected payments and refunds separate and prevents excessive refunds', async () => {
    await issueAndSign((await draft('AGREEMENT')).id)
    const proof = await upload('proof.txt', 'PAYMENT', 'proof', customer)
    await command({ action: 'payment.submit', planId: Number(d.plans[0].id), evidenceFileId: Number(proof.id), amountFen: '30000', note: '待核实' }, customer)
    await command({ action: 'payment.review', id: Number(d.payments[0].id), approve: false, note: '凭证金额不符，请重提' })
    expect(d.plans[0].netFen).toBe('0')
    await command({ action: 'payment.record', planId: Number(d.plans[0].id), amountFen: '30000', kind: 'RECEIPT', note: '实际到账' })
    await command({ action: 'payment.record', planId: Number(d.plans[0].id), amountFen: '5000', kind: 'REFUND', note: '实际已退' })
    expect(d.plans[0]).toMatchObject({ netFen: '25000', remainingFen: '5000', status: 'PARTIAL' }); expect(d.paymentSummary).toContain('存在退款')
    await expect(command({ action: 'payment.record', planId: Number(d.plans[0].id), amountFen: '25001', kind: 'REFUND', note: '超出净收款' })).rejects.toMatchObject({ status: 400 })
  })
  it('preserves issued snapshots across template revisions and verifies full snapshot tampering', async () => {
    const original = await draft('AGREEMENT'); await issueAndSign(original.id)
    const template = (await listContractTemplates())[0], version = template.versions[0]
    await expect(saveTemplateVersion({ ...version, templateId: Number(template.id), versionId: Number(version.id) })).rejects.toMatchObject({ status: 409 })
    const created = await saveTemplateVersion({ ...version, templateId: Number(template.id), documents: { ...version.documents, AGREEMENT: version.documents.AGREEMENT + '\n新版补充条款\n' } })
    await publishTemplateVersion(Number(created.id)); expect((await getCommission(Number(d.id), admin)).documents[0].body).toBe(original.body)
    const stored = await fixture.client.contract.findUniqueOrThrow({ where: { id: Number(original.id) } })
    expect(documentSnapshotHash(stored.snapshotJson!)).toBe(stored.snapshotHash)
    await fixture.client.contract.update({ where: { id: stored.id }, data: { snapshotJson: stored.snapshotJson! + ' ' } })
    const tampered = await fixture.client.contract.findUniqueOrThrow({ where: { id: stored.id } })
    expect(() => assertDocumentSnapshot(tampered)).toThrow('快照校验失败')
  })
  it('unblocks declined changes and cancelled acceptance documents while retaining history', async () => {
    await issueAndSign((await draft('AGREEMENT')).id)
    await command({ action: 'change.create', title: '变更', original: '原项', proposed: '新项', reason: '调整' })
    await command({ action: 'change.quote', id: Number(d.changes[0].id), feeFen: '100', extensionDays: 1, impact: '新增一项' })
    const doc = await draft('CHANGE', d.changes[0].id); await issueAdminContract({ id: Number(doc.id), issuerUserId: 1 })
    await declineUserContract({ id: Number(doc.id), userId: 2, reason: '重新商议费用' }); d = await getCommission(Number(d.id), admin)
    expect(d.changes[0].status).toBe('REJECTED')
    await command({ action: 'change.quote', id: Number(d.changes[0].id), feeFen: '50', extensionDays: 1, impact: '重新商议' })
    const next = await draft('CHANGE', d.changes[0].id); await cancelAdminContract({ id: Number(next.id), issuerUserId: 1 }); d = await getCommission(Number(d.id), admin)
    expect(d.changes[0].status).toBe('QUOTED'); expect(d.documents.some((v) => v.status === -1)).toBe(true)
  })
  it('forces delivery privacy, supports upload retries and rejects tiny masquerading ZIPs', async () => {
    const key = randomUUID(), file = await upload('private.txt', 'DELIVERY', 'private', admin, true, key)
    expect(file.shared).toBe(false)
    await upload('private.txt', 'DELIVERY', 'private', admin, true, key); expect(d.files).toHaveLength(1)
    const customerView = await getCommission(Number(d.id), customer); expect(customerView.files).toEqual([]); expect(JSON.stringify(customerView.events)).not.toContain('private.txt')
    await expect(upload('bad.zip', 'DELIVERY', 'x')).rejects.toMatchObject({ status: 400 })
  })
  it('cleans only legacy contracts once, preserves commissions and seeds template data', async () => {
    await draft('AGREEMENT')
    await fixture.client.contract.create({ data: { contractId: randomUUID(), issuerUserId: 1, subjectUserId: 2, title: '旧合同', body: 'legacy', bodyHash: 'a'.repeat(64), partyCommitment: 'b'.repeat(64) } })
    await upgradeCommissionLifecycle(fixture.client)
    expect(await fixture.client.contract.count({ where: { commissionId: null } })).toBe(0)
    expect(await fixture.client.contract.count({ where: { commissionId: Number(d.id) } })).toBe(1)
    await fixture.client.contract.create({ data: { contractId: randomUUID(), issuerUserId: 1, subjectUserId: 2, title: 'repeat guard', body: 'legacy', bodyHash: 'a'.repeat(64), partyCommitment: 'b'.repeat(64) } })
    await upgradeCommissionLifecycle(fixture.client); expect(await fixture.client.contract.count()).toBe(2)
    expect((await listContractTemplates())[0].versions).toHaveLength(1)
  })
  it('round-trips business data with remapped IDs and ignores broken legacy contract collections', async () => {
    await issueAndSign((await draft('AGREEMENT')).id)
    await upload('source.txt', 'DELIVERY', 'archive bytes')
    await command({ action: 'delivery.create', version: 'v1', kind: 'FINAL', note: '', testInstructions: '运行应用', items: [{ fileId: Number(d.files[0].id), label: '源码', versionNote: 'v1' }] })
    await command({ action: 'delivery.publish', id: Number(d.deliveries[0].id) })
    await saveCommissionSettings({ provider: { Name: '开发方' }, calendar: { holidays: ['2026-10-09'], workdays: [] } }); expect((await getCommissionSettings()).provider.Name).toBe('开发方')
    const backup = await exportDatabaseBackup(); expect(backup.version).toBe('2.9.0')
    const payload = parseDatabaseImportPayload({ version: backup.version, data: backup.data, mode: 'overwrite' })
    await importDatabaseBackup(payload)
    const restored = await fixture.client.commission.findUniqueOrThrow({ where: { commissionId: d.commissionId } }); expect(restored.id).not.toBe(Number(d.id))
    const detail = await getCommission(restored.id, admin); expect(detail.plans.map((p) => p.amountFen)).toEqual(['30000', '40000', '30001']); expect(detail.documents[0].bodyHash).toBe(d.documents[0].bodyHash)
    expect(await (await downloadCommissionFile(restored.id, Number(detail.files[0].id), customer)).text()).toBe('archive bytes')
    const legacy = parseDatabaseImportPayload({ version: '2.8.0', data: { ...backup.data, commissionTemplates: [], commissionTemplateVersions: [], commissionSettings: [], commissions: [], commissionMilestones: [], commissionPlans: [], commissionFiles: [], commissionChanges: [], commissionDeliveries: [], commissionDeliveryItems: [], commissionPayments: [], commissionIssues: [], commissionAcceptances: [], commissionEvents: [], contracts: [{ malformed: true }], contractCredentials: [{ malformed: true }] } })
    expect(legacy.ignoredLegacyContracts).toBe(1); expect(legacy.data.contracts).toEqual([])
  })
  it('retains failed acceptance and retesting history, and records expiry without a customer signature', async () => {
    await issueAndSign((await draft('AGREEMENT')).id)
    const f = await upload('demo.txt', 'DELIVERY', 'testable result')
    await command({ action: 'delivery.create', version: 'test-v1', kind: 'DEMO', note: '', testInstructions: '测试新增与取消订单', items: [{ fileId: Number(f.id), label: '演示', versionNote: 'v1' }] })
    await command({ action: 'delivery.publish', id: Number(d.deliveries[0].id) })
    const deliveryId = Number(d.deliveries[0].id)
    await command({ action: 'acceptance.create', deliveryId, result: 'FAIL', basis: '取消订单失败', outstanding: '修复核心流程后复验' }, customer)
    await issueAndSign((await draft('ACCEPTANCE', d.acceptances[0].id)).id)
    expect(d.acceptedAt).toBeNull()
    await command({ action: 'stage', stage: 'RECTIFICATION', progress: 85, note: '处理取消逻辑', reason: '验收未通过，进入整改' })
    await command({ action: 'acceptance.create', deliveryId, result: 'PASS', basis: '整改后重新测试全流程', outstanding: '' })
    const doc = await draft('ACCEPTANCE', d.acceptances[0].id)
    await issueAdminContract({ id: Number(doc.id), issuerUserId: 1 }); d = await getCommission(Number(d.id), admin)
    const acceptanceId = Number(d.acceptances[0].id)
    await expect(command({ action: 'acceptance.remind', id: acceptanceId, note: '补充书面反馈提醒' })).rejects.toMatchObject({ status: 409 })
    const issuedAt = new Date(d.documents[0].issuedAt!)
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(addWorkingDays(issuedAt, 5).getTime() + 1000))
    await command({ action: 'acceptance.remind', id: acceptanceId, note: '站内再次提醒完整成果已提供，请确认或说明异议' })
    await expect(command({ action: 'acceptance.deem', id: acceptanceId, basis: '核对测试成果、站内两次通知、具体异议和反馈期限后的记录依据' })).rejects.toMatchObject({ status: 409 })
    const due = new Date(d.acceptances[0].supplementalDueAt!)
    vi.setSystemTime(new Date(due.getTime() + 1000))
    await command({ action: 'acceptance.deem', id: acceptanceId, basis: '核对测试成果、站内两次通知、具体异议和反馈期限，期限届满未收到正当异议' })
    expect(d.acceptances.map((a) => a.status)).toEqual(['DEEMED', 'CONFIRMED'])
    expect(d.acceptances[1].result).toBe('FAIL'); expect(d.documents[0]).toMatchObject({ status: 1, signedAt: null })
    expect(d.acceptedAt).not.toBeNull()
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
    await issueAndSign((await draft('AGREEMENT')).id)
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
