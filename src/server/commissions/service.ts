/**
 * @file service.ts
 * @project SlothVault
 * @module Commission Lifecycle Service
 * @description Owns private commissioned work, independent financial facts, development, issues, acceptance and delivery.
 * @logic Authorize the real actor, serialize revision-guarded commands with their audit event, and derive human-readable next actions without inventing signatures or receipts.
 * @dependencies Prisma, unit-of-work, shared commission rules, typed commands
 * @index_tags commissions,lifecycle,authorization,payments,delivery,audit
 * @author holic512
 */
import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { prisma } from '@/server/prisma'
import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { addCalendarDays, addWorkingDays, COMMISSION_STAGES, formatFen, paymentFacts } from '@/lib/commissions'
import type { WorkingCalendar, CommissionStage } from '@/lib/commissions'
import type { CommissionDetail, CommissionDocumentDto } from '@/types/commissions'
import type { CommissionActor, CommissionCommand } from './input'
import { seedCommissionTemplates } from './templates'
import { assertDeliveryManifest, assertDocumentAttachments, verifyCommissionBytes } from './storage'
import type { DocumentAttachment } from './storage'

const include = {
  subjectUser: { select: { username: true, displayName: true } },
  contracts: { include: { credentials: true, attachmentFile: true, issuerUser: { select: { username: true } }, adminAudits: { where: { action: 'ISSUED' }, orderBy: { id: 'desc' }, take: 1, include: { actorUser: { select: { username: true } } } } }, orderBy: { createdAt: 'desc' } },
  milestones: { orderBy: { id: 'asc' } }, plans: { orderBy: { id: 'asc' } }, payments: { orderBy: { id: 'desc' } },
  changes: { orderBy: { id: 'desc' } }, issues: { orderBy: { id: 'desc' } },
  deliveries: { include: { items: { orderBy: { id: 'asc' } } }, orderBy: { id: 'desc' } }, acceptances: { orderBy: { id: 'desc' } },
  files: { include: { file: true }, orderBy: { id: 'desc' } },
  events: { include: { actor: { select: { username: true, displayName: true } } }, orderBy: { id: 'desc' } },
} satisfies Prisma.CommissionInclude
type RecordWithRelations = Prisma.CommissionGetPayload<{ include: typeof include }>
const iso = (date: Date | null) => date?.toISOString() || null
export function jsonObject(value: string | null): Record<string, unknown> { return value ? JSON.parse(value) : {} }
export function requireAdminActor(actor: CommissionActor) { if (!actor.isAdmin) throw new HttpError('此操作需要管理员确认', 403, 403) }
export async function authorizeCommission(client: Pick<Prisma.TransactionClient, 'commission'>, id: number, actor: CommissionActor) {
  const record = await client.commission.findUnique({ where: { id } })
  if (!record || (!actor.isAdmin && record.subjectUserId !== actor.userId)) throw new HttpError('委托项目不存在', 404, 404)
  return record
}
function dto(record: RecordWithRelations, actor: CommissionActor, calendar: WorkingCalendar): CommissionDetail {
  for (const delivery of record.deliveries) assertDeliveryManifest(delivery, record.files)
  const signedAgreement = record.contracts.find((c) => c.documentType === 'AGREEMENT' && c.status === 2)
  const terms = (jsonObject(signedAgreement?.snapshotJson || null).values || {}) as Record<string, unknown>
  const acceptanceDays = Number(terms.acceptanceDays || 5), paymentReminderDays = Number(terms.paymentReminderDays || 3)
  const payments = record.payments.map((p) => ({ id: String(p.id), planId: String(p.planId), amountFen: p.amountFen.toString(), kind: p.kind, status: p.status, note: p.note, evidenceFileId: p.evidenceFileId ? String(p.evidenceFileId) : null, createdAt: p.createdAt.toISOString(), confirmedAt: iso(p.confirmedAt) }))
  const plans = record.plans.map((p) => ({ id: String(p.id), key: p.key, kind: p.kind, title: p.title, amountFen: p.amountFen.toString(), dueAt: iso(p.dueAt), basis: p.basis, remindedAt: iso(p.remindedAt), ...paymentFacts({ amountFen: p.amountFen.toString() }, payments.filter((entry) => entry.planId === String(p.id))) }))
  const documents: CommissionDocumentDto[] = record.contracts.filter((c) => actor.isAdmin || Boolean(c.issuedAt)).map((c) => ({ id: String(c.id), contractId: c.contractId, snapshotHash: c.snapshotHash, title: c.title, documentType: c.documentType as CommissionDocumentDto['documentType'], status: c.status, body: c.body, bodyHash: c.bodyHash, contractHash: c.contractHash, issuedAt: iso(c.issuedAt), signedAt: iso(c.signedAt), declinedAt: iso(c.declinedAt), declineReason: c.declineReason, templateVersionId: c.templateVersionId ? String(c.templateVersionId) : null, sourceRecordId: c.sourceRecordId ? String(c.sourceRecordId) : null, attachment: c.attachmentFile ? { id: String(c.attachmentFile.id), originalName: c.attachmentFile.originalName } : null, values: actor.isAdmin ? (jsonObject(c.snapshotJson).values as Record<string, unknown> || {}) : {}, associatedFiles: assertDocumentAttachments((jsonObject(c.snapshotJson).attachments || []) as DocumentAttachment[], record.files).map((f) => ({ id: String(f.id), originalName: f.file.originalName, fileSize: f.file.fileSize.toString(), sha256: f.sha256 })), providerAccount: c.adminAudits[0]?.actorUser.username || c.issuerUser.username, customerAccount: record.subjectUser.username, credentials: c.credentials.map((e) => ({ id: String(e.id), network: e.network, status: e.status, transactionSignature: e.transactionSignature })) }))
  const deliveries = record.deliveries.filter((d) => actor.isAdmin || d.publishedAt).map((d) => ({ id: String(d.id), version: d.version, kind: d.kind, note: d.note, testInstructions: d.testInstructions, status: d.status, publishedAt: iso(d.publishedAt), receivedAt: iso(d.receivedAt), receiptNote: d.receiptNote, items: d.items.map((i) => ({ id: String(i.id), fileId: i.fileId ? String(i.fileId) : null, label: i.label, url: i.url, versionNote: i.versionNote })) }))
  const publishedFileIds = new Set(deliveries.filter((d) => d.publishedAt).flatMap((d) => d.items.map((i) => i.fileId)))
  const files = record.files.filter((f) => actor.isAdmin || f.shared || f.uploaderUserId === actor.userId || publishedFileIds.has(String(f.id))).map((f) => ({ id: String(f.id), purpose: f.purpose, sha256: f.sha256, uploaderUserId: String(f.uploaderUserId), shared: f.shared, originalName: f.file.originalName, fileSize: f.file.fileSize.toString(), createdAt: f.file.createTime.toISOString() }))
  const effectiveChanges = record.changes.filter((c) => c.status === 'CONFIRMED').reduce((sum, c) => sum + c.feeFen, 0n)
  const todos: CommissionDetail['todos'] = [], warnings: string[] = []
  for (const doc of documents) {
    if (doc.status !== 1) continue
    if (doc.documentType === 'ACCEPTANCE' && record.acceptances.some((a) => String(a.id) === doc.sourceRecordId && a.status === 'DEEMED')) continue
    todos.push({ key: `document-${doc.id}`, audience: 'USER', text: `请阅读并确认《${doc.title}》` })
  }
  for (const payment of payments.filter((p) => p.status === 'PENDING')) todos.push({ key: `payment-${payment.id}`, audience: 'ADMIN', text: '核实客户提交的付款凭证' })
  const labels: Record<string, string> = { START: '首款', PROGRESS: '进度款', FINAL: '尾款', CHANGE: '变更款' }
  let paymentSummary = plans.length ? '已结清' : '付款安排待确认'
  for (const plan of plans) {
    if (plan.status !== 'PAID' && paymentSummary === '已结清') paymentSummary = plan.status === 'PENDING' ? `${labels[plan.kind]}待核实` : plan.status === 'PARTIAL' ? `${labels[plan.kind]}部分支付` : `待付${labels[plan.kind]}`
    if (plan.status !== 'PAID') todos.push({ key: `plan-${plan.id}`, audience: 'USER', text: `${plan.title}尚余 ¥${formatFen(plan.remainingFen)}，请核对约定付款条件`, dueAt: plan.dueAt })
    if (plan.dueAt && new Date(plan.dueAt) < new Date() && plan.status !== 'PAID') warnings.push(`${plan.title}已超过记录的付款日期`)
    if (plan.remindedAt && addWorkingDays(new Date(plan.remindedAt), paymentReminderDays, calendar) < new Date() && plan.status !== 'PAID') warnings.push(`${plan.title}催告后已超过 ${paymentReminderDays} 个工作日，请核对约定及实际到账再安排下一步`)
  }
  const start = plans.find((p) => p.kind === 'START')
  if (start?.status === 'PAID' && plans.find((p) => p.kind === 'PROGRESS')?.status === 'UNPAID') paymentSummary = '已付首款·待付进度款'
  if (plans.find((p) => p.kind === 'PROGRESS')?.status === 'PAID' && plans.find((p) => p.kind === 'FINAL')?.status === 'UNPAID') paymentSummary = '已付进度款·待付尾款'
  if (plans.some((p) => BigInt(p.refundedFen) > 0n)) paymentSummary += '·存在退款'
  if (record.stage === 'DEVELOPMENT' && start && start.status !== 'PAID') warnings.push('项目已进入开发，首款尚未确认结清')
  if (record.stage === 'DEVELOPMENT' && !record.contracts.some((c) => c.documentType === 'AGREEMENT' && c.status === 2)) warnings.push('项目已进入开发，正文与需求附件尚未完成签署')
  if (plans.some((p) => p.kind === 'PROGRESS' && p.status !== 'PAID') && !deliveries.some((d) => d.publishedAt)) warnings.push('进度款约定关联可查看或测试的阶段成果，目前尚无已发布成果，请核对实际沟通后安排付款')
  if (plans.some((p) => p.kind === 'FINAL' && p.status !== 'PAID') && !record.acceptances.some((a) => ['CONFIRMED', 'DEEMED'].includes(a.status) && a.result !== 'FAIL')) warnings.push('尾款约定关联验收通过，目前尚无生效的通过记录，请核对验收安排')
  for (const acceptance of record.acceptances.filter((a) => a.status === 'DRAFT')) todos.push({ key: `acceptance-draft-${acceptance.id}`, audience: 'ADMIN', text: '本轮验收结果已提交，请生成附件三并邀请客户确认' })
  for (const delivery of deliveries.filter((d) => d.publishedAt && d.kind === 'FINAL' && !record.acceptances.some((a) => String(a.deliveryId) === d.id))) todos.push({ key: `acceptance-result-${delivery.id}`, audience: 'USER', text: `请测试 ${delivery.version} 并记录功能验收结果` })
  for (const issue of record.issues.filter((i) => i.status === 'RESOLVED')) todos.push({ key: `retest-${issue.id}`, audience: 'USER', text: `开发方已修复，请复测：${issue.title}` })
  if (record.acceptances.some((a) => a.status === 'CONFIRMED' && a.result === 'CONDITIONAL' && a.outstanding)) warnings.push('已有附条件验收通过记录，请按验收单的遗留问题与期限继续处理')
  for (const delivery of deliveries.filter((d) => d.status === 'PUBLISHED' || d.status === 'INCOMPLETE')) todos.push({ key: `delivery-${delivery.id}`, audience: 'USER', text: `请检查 ${delivery.version} 交付文件并确认接收` })
  for (const acceptance of record.acceptances.filter((a) => a.status === 'SUBMITTED')) {
    const contract = record.contracts.find((c) => c.documentType === 'ACCEPTANCE' && c.sourceRecordId === acceptance.id && c.issuedAt)
    const due = addWorkingDays(contract?.issuedAt || acceptance.createdAt, acceptanceDays, calendar)
    todos.push({ key: `acceptance-${acceptance.id}`, audience: due < new Date() ? 'ADMIN' : 'USER', text: due < new Date() ? '验收反馈期限已到，请核对反馈并补充提醒' : '请依据需求范围测试并集中反馈验收结果', dueAt: iso(due) })
  }
  for (const issue of record.issues.filter((i) => i.status === 'OPEN' || i.status === 'DISPUTED')) todos.push({ key: `issue-${issue.id}`, audience: 'ADMIN', text: `处理${issue.severity === 'SEVERE' ? '严重缺陷' : '问题'}：${issue.title}`, dueAt: iso(issue.dueAt) })
  const maintenanceUntil = record.acceptedAt ? addCalendarDays(record.acceptedAt, record.maintenanceDays) : null
  if (record.stage === 'COMPLETED' && maintenanceUntil && maintenanceUntil > new Date()) warnings.push('项目阶段已完成，免费维护期限仍在履行中')
  if (deliveries.some((d) => d.kind === 'FINAL' && d.publishedAt) && plans.some((p) => p.status !== 'PAID')) warnings.push('成果已交付，仍有款项未结清')
  if (record.expectedDeliveryAt && record.expectedDeliveryAt < new Date() && !['COMPLETED', 'MAINTENANCE', 'TERMINATED'].includes(record.stage)) warnings.push('已超过当前预计交付日期，请更新进展说明')
  if (!todos.length && record.stage === 'ASSESSMENT') todos.push({ key: 'assessment', audience: 'ADMIN', text: '评估需求并提供报价与合作安排' })
  if (!todos.length && record.stage === 'DEVELOPMENT') todos.push({ key: 'progress', audience: 'ADMIN', text: '更新开发进展并提供阶段成果' })
  return {
    id: String(record.id), commissionId: record.commissionId, subjectUserId: String(record.subjectUserId), subject: record.subjectUser,
    title: record.title, purpose: record.purpose, requirements: record.requirements,
    partyA: jsonObject(record.partyAJson) as Record<string, string>, partyB: jsonObject(record.partyBJson) as Record<string, string>,
    quotationFen: record.quotationFen?.toString() ?? null, agreementFen: record.agreementFen?.toString() ?? null, totalFen: record.agreementFen === null ? null : (record.agreementFen + effectiveChanges).toString(),
    stage: record.stage as CommissionStage, progress: record.progress, progressNote: record.progressNote, revision: record.revision,
    expectedDeliveryAt: iso(record.expectedDeliveryAt), startedAt: iso(record.startedAt), acceptedAt: iso(record.acceptedAt),
    adjustmentDays: record.adjustmentDays, maintenanceDays: record.maintenanceDays, adjustmentUntil: record.acceptedAt ? iso(addCalendarDays(record.acceptedAt, record.adjustmentDays)) : null, maintenanceUntil: iso(maintenanceUntil),
    aftercare: { adjustmentRounds: typeof terms.adjustmentRounds === 'number' ? terms.adjustmentRounds : null, adjustmentWorkload: String(terms.adjustmentWorkload || ''), supportChannel: String(terms.supportChannel || '') },
    settlement: jsonObject(record.settlementJson), createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(),
    documents, plans, payments, files, deliveries,
    changes: record.changes.map((c) => ({ id: String(c.id), title: c.title, original: c.original, proposed: c.proposed, reason: c.reason, impact: c.impact, feeFen: c.feeFen.toString(), extensionDays: c.extensionDays, status: c.status, createdAt: c.createdAt.toISOString(), confirmedAt: iso(c.confirmedAt) })),
    issues: record.issues.map((i) => ({ id: String(i.id), title: i.title, deliveryId: i.deliveryId ? String(i.deliveryId) : null, kind: i.kind, severity: i.severity, status: i.status, steps: i.steps, expected: i.expected, actual: i.actual, resolution: i.resolution, fileIds: JSON.parse(i.fileIdsJson).map(String), dueAt: iso(i.dueAt), createdAt: i.createdAt.toISOString() })),
    acceptances: record.acceptances.map((a) => ({ id: String(a.id), deliveryId: String(a.deliveryId), result: a.result, basis: a.basis, outstanding: a.outstanding, status: a.status, createdAt: a.createdAt.toISOString(), confirmedAt: iso(a.confirmedAt), remindedAt: iso(a.remindedAt), supplementalDueAt: iso(a.supplementalDueAt), deemedBasis: a.deemedBasis })),
    milestones: record.milestones.map((m) => ({ id: String(m.id), title: m.title, description: m.description, dueAt: iso(m.dueAt), completedAt: iso(m.completedAt) })),
    events: record.events.filter((e) => actor.isAdmin || (!['DOCUMENT_DRAFT', 'delivery.create', 'delivery.update'].includes(e.type) && !(e.type === 'FILE_UPLOADED' && jsonObject(e.dataJson).shared === false))).map((e) => ({ id: String(e.id), type: e.type, note: e.note, data: jsonObject(e.dataJson), createdAt: e.createdAt.toISOString(), actor: e.actor.displayName || e.actor.username })),
    todos, warnings, paymentSummary,
  }
}
export async function getCommission(id: number, actor: CommissionActor) {
  await authorizeCommission(prisma, id, actor)
  const [record, settings] = await Promise.all([prisma.commission.findUniqueOrThrow({ where: { id }, include }), prisma.commissionSettings.findUnique({ where: { id: 1 } })])
  return dto(record, actor, jsonObject(settings?.calendarJson || '{}') as WorkingCalendar)
}
export async function listCommissions(actor: CommissionActor, input: { page: number; pageSize: number; keyword?: string; stage?: string }) {
  const where: Prisma.CommissionWhereInput = { ...(actor.isAdmin ? {} : { subjectUserId: actor.userId }), ...(input.keyword ? { title: { contains: input.keyword } } : {}), ...(input.stage ? { stage: input.stage } : {}) }
  const [total, records, settings] = await Promise.all([prisma.commission.count({ where }), prisma.commission.findMany({ where, skip: (input.page - 1) * input.pageSize, take: input.pageSize, orderBy: { updatedAt: 'desc' }, include }), prisma.commissionSettings.findUnique({ where: { id: 1 } })])
  return { total, page: input.page, pageSize: input.pageSize, list: records.map((r) => dto(r, actor, jsonObject(settings?.calendarJson || '{}') as WorkingCalendar)) }
}
export async function createCommission(actor: CommissionActor, input: { commandId: string; title: string; purpose: string; requirements: string; subjectUserId?: number; quotationFen?: string; partyA?: Record<string, string> }) {
  const subjectUserId = actor.isAdmin ? input.subjectUserId : actor.userId
  if (!subjectUserId) throw new HttpError('请选择客户账户', 400, 400)
  const user = await prisma.user.findUnique({ where: { id: subjectUserId }, select: { role: true, status: true } })
  if (!user || user.role !== 'USER' || user.status !== 1) throw new HttpError('客户必须是启用的普通账户', 400, 400)
  await seedCommissionTemplates()
  const identity = createHash('sha256').update(`${actor.userId}:${input.commandId}`).digest('hex').slice(0, 24)
  const existing = await prisma.commission.findUnique({ where: { commissionId: `SV-${identity}` } })
  if (existing) return getCommission(existing.id, actor)
  const settings = await prisma.commissionSettings.findUnique({ where: { id: 1 } })
  const record = await unitOfWork.execute((tx) => tx.commission.create({ data: { commissionId: `SV-${identity}`, subjectUserId, title: input.title, purpose: input.purpose, requirements: input.requirements, partyAJson: JSON.stringify(input.partyA || {}), partyBJson: settings?.providerJson || '{}', quotationFen: actor.isAdmin && input.quotationFen ? BigInt(input.quotationFen) : null, events: { create: { actorUserId: actor.userId, commandId: input.commandId, type: 'CREATED', note: actor.isAdmin ? '开发方建立委托项目并邀请客户参与' : '客户提交委托需求' } } } })).catch(async (error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      const duplicate = await prisma.commission.findUnique({ where: { commissionId: `SV-${identity}` } })
      if (duplicate) return duplicate
    }
    throw error
  })
  return getCommission(record.id, actor)
}
export async function executeCommissionCommand(id: number, actor: CommissionActor, input: CommissionCommand) {
  await unitOfWork.execute(async (tx) => {
    const current = await authorizeCommission(tx, id, actor)
    const duplicate = await tx.commissionEvent.findUnique({ where: { commissionId_commandId: { commissionId: id, commandId: input.commandId } } })
    if (duplicate) { if (duplicate.actorUserId !== actor.userId || duplicate.type !== input.action) throw new HttpError('请求标识已用于其他操作', 409, 409); return }
    const updated = await tx.commission.updateMany({ where: { id, revision: input.revision }, data: { revision: { increment: 1 }, updatedAt: new Date() } })
    if (updated.count !== 1) throw new HttpError('项目已更新，请刷新后重试', 409, 409)
    const requireFile = async (fileId: number) => {
      const file = await tx.commissionFile.findFirst({ where: { id: fileId, commissionId: id }, include: { file: true, items: { include: { delivery: true } } } })
      if (!file || file.file.status !== 1 || (!actor.isAdmin && file.uploaderUserId !== actor.userId && !file.shared && !file.items.some((i) => i.delivery.publishedAt))) throw new HttpError('文件不属于当前委托或尚未发布', 404, 404)
      return file
    }
    const requirePlan = async (planId: number) => {
      const plan = await tx.commissionPaymentPlan.findFirst({ where: { id: planId, commissionId: id }, include: { payments: true } })
      if (!plan) throw new HttpError('付款安排不存在', 404, 404)
      return plan
    }
    let note: string = input.action, data: Record<string, unknown> = {}
    switch (input.action) {
      case 'update': {
        if (!actor.isAdmin && (input.partyB || input.quotationFen !== undefined)) throw new HttpError('报价和开发方资料由管理员填写', 403, 403)
        if (current.agreementFen !== null && input.quotationFen !== undefined) throw new HttpError('已签约金额请通过需求变更处理', 409, 409)
        await tx.commission.update({ where: { id }, data: { title: input.title, purpose: input.purpose, requirements: input.requirements, partyAJson: input.partyA ? JSON.stringify(input.partyA) : undefined, partyBJson: input.partyB ? JSON.stringify(input.partyB) : undefined, quotationFen: input.quotationFen === undefined ? undefined : BigInt(input.quotationFen) } })
        note = '更新委托需求、报价或合同主体资料'; break
      }
      case 'stage': {
        requireAdminActor(actor)
        const stages = Object.keys(COMMISSION_STAGES)
        if ((Math.abs(stages.indexOf(input.stage) - stages.indexOf(current.stage)) > 1 || stages.indexOf(input.stage) < stages.indexOf(current.stage) || ['PAUSED', 'TERMINATED'].includes(input.stage)) && !input.reason.trim()) throw new HttpError('跨阶段、回退、暂停或终止时请说明原因', 400, 400)
        await tx.commission.update({ where: { id }, data: { stage: input.stage, progress: input.progress, progressNote: input.note, expectedDeliveryAt: input.expectedDeliveryAt === undefined ? undefined : input.expectedDeliveryAt ? new Date(input.expectedDeliveryAt) : null, startedAt: input.stage === 'DEVELOPMENT' && !current.startedAt ? new Date() : undefined } })
        note = input.note || '更新项目阶段'; data = { from: current.stage, to: input.stage, progress: input.progress, reason: input.reason }; break
      }
      case 'comment': note = input.note; break
      case 'milestone': {
        requireAdminActor(actor)
        const value = { title: input.title, description: input.description, dueAt: input.dueAt ? new Date(input.dueAt) : null, completedAt: input.completed ? new Date() : null }
        if (input.id) { const changed = await tx.commissionMilestone.updateMany({ where: { id: input.id, commissionId: id }, data: value }); if (changed.count !== 1) throw new HttpError('里程碑不存在', 404, 404) }
        else await tx.commissionMilestone.create({ data: { ...value, commissionId: id } })
        note = `更新里程碑：${input.title}`; break
      }
      case 'payment.submit': case 'payment.record': {
        if (input.action === 'payment.record') requireAdminActor(actor)
        const plan = await requirePlan(input.planId)
        if (input.evidenceFileId) { const proof = await requireFile(input.evidenceFileId); if (input.action === 'payment.submit' && proof.purpose !== 'PAYMENT') throw new HttpError('请选择付款凭证用途的文件', 400, 400) }
        const kind = input.action === 'payment.record' ? input.kind : 'RECEIPT'
        if (kind === 'REFUND') {
          const facts = paymentFacts({ amountFen: plan.amountFen.toString() }, plan.payments.map((p) => ({ ...p, amountFen: p.amountFen.toString() })))
          if (BigInt(input.amountFen) > BigInt(facts.netFen)) throw new HttpError('退款不能超过该付款安排的净收款', 400, 400)
        }
        const payment = await tx.commissionPayment.create({ data: { commissionId: id, planId: input.planId, amountFen: BigInt(input.amountFen), kind, note: input.note, evidenceFileId: input.evidenceFileId, createdById: actor.userId, status: input.action === 'payment.record' ? 'CONFIRMED' : 'PENDING', confirmedAt: input.action === 'payment.record' ? new Date() : null, confirmedById: input.action === 'payment.record' ? actor.userId : null } })
        note = input.action === 'payment.record' ? `${kind === 'REFUND' ? '记录实际退款' : '确认线下到账'}：${plan.title}` : `提交付款凭证：${plan.title}`; data = { paymentId: payment.id, amountFen: input.amountFen, kind, note: input.note }; break
      }
      case 'payment.review': {
        requireAdminActor(actor)
        const changed = await tx.commissionPayment.updateMany({ where: { id: input.id, commissionId: id, status: 'PENDING' }, data: { status: input.approve ? 'CONFIRMED' : 'REJECTED', confirmedById: actor.userId, confirmedAt: new Date(), note: input.note } })
        if (changed.count !== 1) throw new HttpError('凭证已处理或不存在', 409, 409)
        note = input.approve ? '付款凭证已核实到账' : '付款凭证被驳回'; data = { paymentId: input.id, note: input.note }; break
      }
      case 'payment.schedule': case 'payment.remind': {
        requireAdminActor(actor); await requirePlan(input.planId)
        await tx.commissionPaymentPlan.update({ where: { id: input.planId }, data: input.action === 'payment.schedule' ? { dueAt: input.dueAt ? new Date(input.dueAt) : null, basis: input.basis } : { remindedAt: new Date() } })
        note = input.action === 'payment.remind' ? input.note : '更新付款安排日期与成果依据'; data = { planId: input.planId }; break
      }
      case 'change.create': {
        const change = await tx.commissionChange.create({ data: { commissionId: id, title: input.title, original: input.original, proposed: input.proposed, reason: input.reason, createdById: actor.userId } })
        note = `提出需求变更：${input.title}`; data = { changeId: change.id }; break
      }
      case 'change.quote': {
        requireAdminActor(actor)
        const issued = await tx.contract.count({ where: { commissionId: id, documentType: 'CHANGE', sourceRecordId: input.id, status: { in: [1, 2] } } })
        if (issued) throw new HttpError('变更确认单已发起，报价不可覆盖', 409, 409)
        const changed = await tx.commissionChange.updateMany({ where: { id: input.id, commissionId: id, status: { in: ['PROPOSED', 'QUOTED', 'REJECTED'] } }, data: { feeFen: BigInt(input.feeFen), extensionDays: input.extensionDays, impact: input.impact, status: 'QUOTED' } })
        if (changed.count !== 1) throw new HttpError('变更不存在或已经确认', 409, 409)
        note = '开发方评估变更费用与工期'; data = { changeId: input.id, feeFen: input.feeFen, extensionDays: input.extensionDays }; break
      }
      case 'issue.create': {
        if (input.deliveryId) { const delivery = await tx.commissionDelivery.findFirst({ where: { id: input.deliveryId, commissionId: id, ...(actor.isAdmin ? {} : { publishedAt: { not: null } }) } }); if (!delivery) throw new HttpError('成果版本不存在或尚未发布', 404, 404) }
        for (const fileId of input.fileIds) await requireFile(fileId)
        const issue = await tx.commissionIssue.create({ data: { commissionId: id, title: input.title, deliveryId: input.deliveryId, kind: input.kind, severity: input.severity, steps: input.steps, expected: input.expected, actual: input.actual, fileIdsJson: JSON.stringify(input.fileIds), createdById: actor.userId, dueAt: input.dueAt ? new Date(input.dueAt) : null } })
        note = `反馈问题：${input.title}`; data = { issueId: issue.id }; break
      }
      case 'issue.update': {
        if (!actor.isAdmin && (!['CLOSED', 'DISPUTED', 'OPEN'].includes(input.status) || input.kind || input.dueAt)) throw new HttpError('客户可确认解决或提出异议，分类和修复由开发方处理', 403, 403)
        const changed = await tx.commissionIssue.updateMany({ where: { id: input.id, commissionId: id }, data: { status: input.status, resolution: input.resolution, kind: input.kind, dueAt: input.dueAt ? new Date(input.dueAt) : undefined, resolvedAt: input.status === 'RESOLVED' || input.status === 'CLOSED' ? new Date() : null } })
        if (changed.count !== 1) throw new HttpError('问题不存在', 404, 404)
        note = input.resolution; data = { issueId: input.id, status: input.status }; break
      }
      case 'delivery.create': case 'delivery.update': {
        requireAdminActor(actor)
        for (const item of input.items) {
          if (item.fileId) await requireFile(item.fileId)
          if (item.url) { const url = new URL(item.url); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new HttpError('外部交付链接必须是不含认证凭据的 HTTP 地址', 400, 400); if (!item.versionNote.trim()) throw new HttpError('外部资源请填写版本或 Git 提交号', 400, 400) }
        }
        if (input.action === 'delivery.update') {
          const draft = await tx.commissionDelivery.findFirst({ where: { id: input.id, commissionId: id, status: 'DRAFT', publishedAt: null } })
          if (!draft) throw new HttpError('只有未发布的交付草稿可以修改', 409, 409)
          await tx.commissionDeliveryItem.deleteMany({ where: { deliveryId: draft.id } })
        }
        const value = { version: input.version, kind: input.kind, note: input.note, testInstructions: input.testInstructions, items: { create: input.items } }
        const delivery = input.action === 'delivery.update' ? await tx.commissionDelivery.update({ where: { id: input.id }, data: value }) : await tx.commissionDelivery.create({ data: { commissionId: id, ...value } })
        note = `建立${input.kind === 'DEMO' ? '阶段成果' : '完整交付'}草稿：${input.version}`; data = { deliveryId: delivery.id }; break
      }
      case 'delivery.publish': {
        requireAdminActor(actor)
        const delivery = await tx.commissionDelivery.findFirst({ where: { id: input.id, commissionId: id, status: 'DRAFT' }, include: { items: { orderBy: { id: 'asc' } } } })
        if (!delivery) throw new HttpError('交付批次不存在或已经发布', 409, 409)
        const manifest = []
        for (const item of delivery.items) { const file = item.fileId ? await requireFile(item.fileId) : null; if (file) await verifyCommissionBytes(file); manifest.push({ label: item.label, url: item.url, versionNote: item.versionNote, fileId: item.fileId, originalName: file?.file.originalName || null, sha256: file?.sha256 || null, fileSize: file?.file.fileSize.toString() || null }) }
        await tx.commissionDelivery.update({ where: { id: delivery.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), manifestJson: JSON.stringify(manifest) } })
        note = `正式发布交付版本：${delivery.version}`; data = { deliveryId: delivery.id, manifest }; break
      }
      case 'delivery.receive': {
        if (actor.isAdmin) throw new HttpError('接收结果必须由客户本人确认', 403, 403)
        if (!input.received && !input.note.trim()) throw new HttpError('请说明缺失的文件或资料', 400, 400)
        const changed = await tx.commissionDelivery.updateMany({ where: { id: input.id, commissionId: id, publishedAt: { not: null } }, data: { status: input.received ? 'RECEIVED' : 'INCOMPLETE', receivedAt: input.received ? new Date() : null, receiptNote: input.note } })
        if (changed.count !== 1) throw new HttpError('交付版本尚未发布', 409, 409)
        note = input.received ? '客户确认交付文件已接收' : '客户反馈交付文件缺失'; data = { deliveryId: input.id, note: input.note }; break
      }
      case 'acceptance.create': {
        const delivery = await tx.commissionDelivery.findFirst({ where: { id: input.deliveryId, commissionId: id, publishedAt: { not: null } } })
        if (!delivery || !delivery.testInstructions.trim()) throw new HttpError('请先发布可测试成果并提供测试说明', 400, 400)
        if (input.result === 'CONDITIONAL' && !input.outstanding.trim()) throw new HttpError('附条件验收请明确遗留问题与修复期限', 400, 400)
        const acceptance = await tx.commissionAcceptance.create({ data: { commissionId: id, deliveryId: input.deliveryId, result: input.result, basis: input.basis, outstanding: input.outstanding } })
        note = `${actor.isAdmin ? '开发方' : '客户'}提交本轮验收结果，待生成确认单并由双方确认`; data = { acceptanceId: acceptance.id, result: input.result }; break
      }
      case 'acceptance.remind': case 'acceptance.deem': {
        requireAdminActor(actor)
        const acceptance = await tx.commissionAcceptance.findFirst({ where: { id: input.id, commissionId: id, status: 'SUBMITTED' } })
        const contract = await tx.contract.findFirst({ where: { commissionId: id, documentType: 'ACCEPTANCE', sourceRecordId: input.id, status: 1, issuedAt: { not: null } } })
        if (!acceptance || !contract?.issuedAt) throw new HttpError('验收记录尚未发起或已处理', 409, 409)
        const settings = await tx.commissionSettings.findUnique({ where: { id: 1 } }), calendar = jsonObject(settings?.calendarJson || '{}') as WorkingCalendar
        const agreement = await tx.contract.findFirst({ where: { commissionId: id, documentType: 'AGREEMENT', status: 2 } })
        const terms = (jsonObject(agreement?.snapshotJson || null).values || {}) as Record<string, unknown>
        const acceptanceDays = Number(terms.acceptanceDays || 5), supplementalDays = Math.max(3, Number(terms.supplementalDays || 3))
        if (input.action === 'acceptance.remind') {
          if (new Date() < addWorkingDays(contract.issuedAt, acceptanceDays, calendar)) throw new HttpError('完整验收反馈期限尚未届满', 409, 409)
          await tx.commissionAcceptance.update({ where: { id: acceptance.id }, data: { remindedAt: new Date(), supplementalDueAt: addWorkingDays(new Date(), supplementalDays, calendar) } }); note = input.note
        } else {
          if (!acceptance.supplementalDueAt || new Date() < acceptance.supplementalDueAt || acceptance.result === 'FAIL') throw new HttpError('补充反馈期限未到或验收结果不支持视为通过', 409, 409)
          if (await tx.commissionIssue.count({ where: { commissionId: id, status: { in: ['OPEN', 'DISPUTED'] } } })) throw new HttpError('仍有具体异议，请处理后再确认验收', 409, 409)
          await tx.commissionAcceptance.update({ where: { id: acceptance.id }, data: { status: 'DEEMED', confirmedAt: new Date(), deemedBasis: input.basis } })
          if (!current.acceptedAt) await tx.commission.update({ where: { id }, data: { acceptedAt: new Date() } })
          note = '开发方依据提醒与期限记录视为验收，未代客户签署'; data = { acceptanceId: acceptance.id, basis: input.basis }
        }
        break
      }
      case 'settlement': {
        requireAdminActor(actor)
        const { action: _action, commandId: _command, revision: _revision, ...settlement } = input
        void _action; void _command; void _revision
        await tx.commission.update({ where: { id }, data: { settlementJson: JSON.stringify(settlement) } })
        note = '记录暂停或解除后的工作、账款、知识产权与资料处理安排'; data = settlement; break
      }
    }
    await tx.commissionEvent.create({ data: { commissionId: id, actorUserId: actor.userId, commandId: input.commandId, type: input.action, note, dataJson: JSON.stringify(data) } })
  })
  return getCommission(id, actor)
}
export async function getCommissionSettings() {
  await seedCommissionTemplates()
  const record = await prisma.commissionSettings.findUniqueOrThrow({ where: { id: 1 } })
  return { provider: jsonObject(record.providerJson), calendar: { holidays: [], workdays: [], ...jsonObject(record.calendarJson) } }
}
export async function saveCommissionSettings(input: { provider: Record<string, string>; calendar: WorkingCalendar }) {
  await prisma.commissionSettings.upsert({ where: { id: 1 }, create: { id: 1, providerJson: JSON.stringify(input.provider), calendarJson: JSON.stringify(input.calendar) }, update: { providerJson: JSON.stringify(input.provider), calendarJson: JSON.stringify(input.calendar) } })
  return getCommissionSettings()
}
export function commissionEventCommandId() { return randomUUID() }
