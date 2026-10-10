/**
 * @file workflow.ts
 * @project SlothVault
 * @module Commission Lifecycle
 * @description Owns explicit lifecycle commands, independent payment progress and delivery-started maintenance.
 * @logic Authorize actors, reserve the revision, validate stage boundaries and atomically append immutable submissions with projection updates.
 * @dependencies Prisma, unit-of-work, submission snapshots, Markdown templates
 * @index_tags commissions,lifecycle,contracts,maintenance,authorization
 * @author holic512
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { prisma } from '@/server/prisma'
import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { formatFen } from '@/lib/commissions'
import { renderSimpleTemplate, type WorkflowDetail, type WorkflowSummary, type WorkflowStage, type SubmissionSnapshot, type SimpleTemplateVersion, type WorkflowIssue } from '@/lib/commission-workflow'
import type { CommissionActor } from './input'
import { appendSubmission, canonicalJson, digest, snapshotFiles, verifySubmissionChain } from './submissions'
import { simpleVersionDto, templateInput } from './simple-templates'
import { workflowCreateInput, type WorkflowCommand } from './workflow-input'
import type { z } from 'zod'

type Client = Pick<Prisma.TransactionClient, 'commission'>
export async function authorizeWorkflow(tx: Client, id: number, actor: CommissionActor, write = false) {
  const row = await tx.commission.findUnique({ where: { id } })
  if (!row || (!actor.isAdmin && row.subjectUserId !== actor.userId)) throw new HttpError('委托不存在', 404, 404)
  if (write && row.workflowVersion !== 2) throw new HttpError('旧委托为只读历史，请建立新委托', 409, 409)
  return row
}
const summaryInclude = { subjectUser: { select: { username: true, displayName: true } }, invitations: { orderBy: { id: 'desc' }, take: 1 } } satisfies Prisma.CommissionInclude
type SummaryRecord = Prisma.CommissionGetPayload<{ include: typeof summaryInclude }>
const include = {
  ...summaryInclude, agreements: { orderBy: { id: 'desc' } },
  submissions: { orderBy: { sequence: 'asc' }, include: { proofs: { orderBy: { id: 'desc' } } } },
  files: { include: { file: true }, orderBy: { id: 'desc' } },
} satisfies Prisma.CommissionInclude
type Record = Prisma.CommissionGetPayload<{ include: typeof include }>
function bindingStatus(row: SummaryRecord) {
  if (row.subjectUserId) return 'CLAIMED'
  const latest = row.invitations[0]
  return latest && !latest.revokedAt && latest.expiresAt > new Date() ? 'INVITED' : latest ? 'EXPIRED' : 'UNASSIGNED'
}
function actions(row: Record, actor: CommissionActor) {
  if (row.workflowVersion !== 2) return []
  const result: string[] = []
  if (actor.isAdmin) result.push('payment.update')
  if (['COMPLETED', 'TERMINATED'].includes(row.stage)) return [...result, 'issue.update']
  result.push('submission.create', 'issue.update')
  if (row.stage === 'DRAFT') result.push('draft.update', 'request.submit')
  if (actor.isAdmin) {
    if (!row.subjectUserId) result.push('invitation.create', 'invitation.revoke')
    if (row.stage === 'REQUESTED') result.push('request.accept', 'request.return')
    if (!['DRAFT', 'REQUESTED'].includes(row.stage)) result.push('agreement.save')
    if (row.stage === 'DRAFT') result.push('agreement.save')
    if (row.subjectUserId && !row.paused && ['ACCEPTED', 'CONTRACT_PENDING', 'READY', 'IN_PROGRESS', 'MAINTENANCE'].includes(row.stage)) result.push('agreement.publish', 'agreement.offline')
    if (row.stage === 'READY' && !row.paused) result.push('project.start')
    if (row.stage === 'IN_PROGRESS' && !row.paused) result.push('delivery.publish')
    result.push('project.pause', 'project.terminate')
  } else if (!row.paused) result.push('agreement.confirm', 'agreement.decline')
  if (row.stage === 'MAINTENANCE' && !row.maintenanceClosedAt) {
    result.push('maintenance.close')
    if (!row.paused && row.maintenanceEndsAt && row.maintenanceEndsAt > new Date()) result.push('issue.create')
  }
  return result
}
function summary(row: SummaryRecord): WorkflowSummary {
  const labels: { [key: string]: string } = { DRAFT: '提交委托需求', REQUESTED: '等待管理员接单', ACCEPTED: '准备合同与细则', CONTRACT_PENDING: '确认当前合同', READY: '管理员开始实施', IN_PROGRESS: '更新进展或提交成果', MAINTENANCE: '反馈与处理维护问题', COMPLETED: '查看归档与未解决问题', TERMINATED: '查看终止记录' }
  return { id: String(row.id), publicId: row.commissionId, title: row.title, subject: row.subjectUser ? row.subjectUser.displayName || row.subjectUser.username : null,
    stage: row.stage as WorkflowStage, paused: row.paused, paymentPercent: row.paymentPercent, updatedAt: row.updatedAt.toISOString(), bindingStatus: bindingStatus(row),
    nextAction: row.workflowVersion !== 2 ? '只读历史记录' : row.paused ? '项目已暂停' : !row.subjectUserId ? '等待用户认领' : labels[row.stage] || '', archived: row.workflowVersion !== 2 }
}
export function issuesFromSnapshots(snapshots: SubmissionSnapshot[]): WorkflowIssue[] {
  const issues = new Map<string, WorkflowIssue>()
  for (const snapshot of snapshots) {
    if (snapshot.type === 'issue.create') issues.set(snapshot.eventId, { id: snapshot.eventId, title: String(snapshot.data.title), status: 'OPEN', resolution: '' })
    if (snapshot.type === 'issue.update') {
      const issue = issues.get(String(snapshot.data.issueId))
      if (issue) { issue.status = String(snapshot.data.status); issue.resolution = snapshot.note }
    }
  }
  return [...issues.values()]
}
function detail(row: Record, actor: CommissionActor): WorkflowDetail {
  verifySubmissionChain(row.submissions, row.commissionId)
  const snapshots = row.submissions.map((event) => JSON.parse(event.snapshotJson) as SubmissionSnapshot)
  const publishedFiles = new Set(snapshots.flatMap((snapshot) => snapshot.attachments.map((file) => file.key)))
  for (const snapshot of snapshots) for (const attachment of snapshot.attachments) {
    const file = row.files.find((item) => item.file.fileName === attachment.key)
    if (!file || file.sha256 !== attachment.sha256 || file.file.fileSize.toString() !== attachment.size || file.file.originalName !== attachment.name || file.purpose !== attachment.purpose || !file.shared) throw new HttpError('正式附件与快照清单不一致', 409, 409)
  }
  for (const agreement of row.agreements.filter((item) => item.publishedEventId)) {
    const publication = snapshots.find((snapshot) => snapshot.eventId === agreement.publishedEventId)
    const actual = { publicId: agreement.publicId, title: agreement.title, kind: agreement.kind, body: agreement.body, template: JSON.parse(agreement.templateJson), values: JSON.parse(agreement.valuesJson), totalFen: agreement.totalFen?.toString() || null, maintenanceDays: agreement.maintenanceDays, confirmationMode: agreement.confirmationMode }
    if (!publication || canonicalJson(publication.data.agreement) !== canonicalJson(actual) || canonicalJson(publication.attachments.map((file) => file.key)) !== canonicalJson(JSON.parse(agreement.fileKeysJson))) throw new HttpError('合同与冻结记录不一致', 409, 409)
  }
  return { ...summary(row), revision: row.revision, requirements: row.requirements, progress: row.progress, totalFen: row.agreementFen?.toString() || null, confirmationMode: row.confirmationMode, maintenanceDays: row.maintenanceDays,
    maintenanceStartedAt: row.maintenanceStartedAt?.toISOString() || null, maintenanceEndsAt: row.maintenanceEndsAt?.toISOString() || null, maintenanceClosedAt: row.maintenanceClosedAt?.toISOString() || null, maintenanceCloseReason: row.maintenanceCloseReason,
    events: row.submissions.map((event, i) => ({ id: event.publicId, hash: event.snapshotHash, snapshot: snapshots[i], proofs: event.proofs.map((proof) => ({ id: String(proof.id), network: proof.network, status: proof.status, signature: proof.transactionSignature, blockTime: proof.blockTime?.toISOString() || null, error: proof.error, expiresAt: proof.expiresAt.toISOString() })) })),
    files: row.files.filter((file) => publishedFiles.has(file.file.fileName) || file.uploaderUserId === actor.userId).map((file) => ({ id: String(file.id), key: file.file.fileName, name: file.file.originalName, size: file.file.fileSize.toString(), sha256: file.sha256, purpose: file.purpose, submitted: publishedFiles.has(file.file.fileName), mine: file.uploaderUserId === actor.userId })),
    agreements: row.agreements.filter((agreement) => actor.isAdmin || agreement.status !== 'DRAFT').map((agreement) => ({ id: String(agreement.id), publicId: agreement.publicId, kind: agreement.kind, status: agreement.status, title: agreement.title, body: agreement.body, template: JSON.parse(agreement.templateJson), values: JSON.parse(agreement.valuesJson), fileKeys: JSON.parse(agreement.fileKeysJson), totalFen: agreement.totalFen?.toString() || null, maintenanceDays: agreement.maintenanceDays, confirmationMode: agreement.confirmationMode, publishedEventId: agreement.publishedEventId, confirmedAt: agreement.confirmedAt?.toISOString() || null })),
    issues: issuesFromSnapshots(snapshots), allowedActions: actions(row, actor),
  }
}
export async function getWorkflow(id: number, actor: CommissionActor): Promise<WorkflowDetail> {
  await authorizeWorkflow(prisma, id, actor)
  return detail(await prisma.commission.findUniqueOrThrow({ where: { id }, include }), actor)
}
export async function listWorkflows(actor: CommissionActor, input: { page: number; pageSize: number; keyword?: string; stage?: string }) {
  const where: Prisma.CommissionWhereInput = { ...(actor.isAdmin ? {} : { subjectUserId: actor.userId }), ...(input.keyword ? { title: { contains: input.keyword } } : {}), ...(input.stage ? { stage: input.stage } : {}) }
  const [total, rows] = await Promise.all([prisma.commission.count({ where }), prisma.commission.findMany({ where, include: summaryInclude, skip: (input.page - 1) * input.pageSize, take: input.pageSize, orderBy: { updatedAt: 'desc' } })])
  return { total, page: input.page, pageSize: input.pageSize, list: rows.map(summary) }
}
export async function createWorkflow(actor: CommissionActor, input: z.infer<typeof workflowCreateInput>) {
  const publicId = `SV-${digest(`${actor.userId}:${input.commandId}`).slice(0, 24)}`
  const requestHash = digest(canonicalJson(input))
  const existing = await prisma.commission.findUnique({ where: { commissionId: publicId }, include: { events: { where: { commandId: input.commandId } } } })
  if (existing) {
    if (existing.events[0]?.dataJson !== JSON.stringify({ requestHash })) throw new HttpError('请求标识已用于不同内容', 409, 409)
    return getWorkflow(existing.id, actor)
  }
  const subjectUserId = actor.isAdmin ? input.subjectUserId || null : actor.userId
  if (subjectUserId) {
    const user = await prisma.user.findFirst({ where: { id: subjectUserId, role: 'USER', status: 1 } })
    if (!user) throw new HttpError('请选择启用的普通用户', 400, 400)
  }
  if (!input.draft && !input.requirements.trim()) throw new HttpError('请填写委托需求', 400, 400)
  const row = await unitOfWork.execute(async (tx) => {
    const prior = await tx.commission.findUnique({ where: { commissionId: publicId }, include: { events: { where: { commandId: input.commandId } } } })
    if (prior) {
      if (prior.events[0]?.dataJson !== JSON.stringify({ requestHash })) throw new HttpError('请求标识已用于不同内容', 409, 409)
      return prior
    }
    const row = await tx.commission.create({ data: { commissionId: publicId, workflowVersion: 2, subjectUserId, title: input.title, requirements: input.requirements, purpose: '', stage: input.draft ? 'DRAFT' : 'REQUESTED', maintenanceDays: 15 } })
    await tx.commissionEvent.create({ data: { commissionId: row.id, actorUserId: actor.userId, commandId: input.commandId, type: 'workflow.create', note: '建立委托', dataJson: JSON.stringify({ requestHash }) } })
    if (!input.draft) await appendSubmission(tx, row, actor, { commandId: input.commandId, requestHash, type: 'request.submit', note: input.requirements, data: { title: input.title } })
    return row
  }).catch(async (error: unknown) => {
    const committed = await prisma.commission.findUnique({ where: { commissionId: publicId }, include: { events: { where: { commandId: input.commandId } } } })
    if (committed?.events[0]?.dataJson === JSON.stringify({ requestHash })) return committed
    throw error
  })
  return getWorkflow(row.id, actor)
}

export async function executeWorkflowCommand(id: number, actor: CommissionActor, input: WorkflowCommand) {
  await unitOfWork.execute(async (tx) => {
    const current = await authorizeWorkflow(tx, id, actor, true)
    const { revision: _revision, ...request } = input
    void _revision
    const requestHash = digest(canonicalJson(request))
    const duplicate = await tx.commissionEvent.findUnique({ where: { commissionId_commandId: { commissionId: id, commandId: input.commandId } } })
    if (duplicate) {
      if (duplicate.actorUserId !== actor.userId || duplicate.type !== input.action || duplicate.dataJson !== JSON.stringify({ requestHash })) throw new HttpError('请求标识已用于不同操作', 409, 409)
      return
    }
    const locked = await tx.commission.updateMany({ where: { id, revision: input.revision }, data: { revision: { increment: 1 }, updatedAt: new Date() } })
    if (!locked.count) throw new HttpError('委托已更新，请刷新后重试', 409, 409)
    const loaded = await tx.commission.findUniqueOrThrow({ where: { id }, include })
    if (!actions(loaded, actor).includes(input.action)) throw new HttpError('当前阶段或身份不允许此操作', 403, 403)
    let note = 'note' in input ? input.note : '', data: { [key: string]: unknown } = {}, reference = 'reference' in input ? input.reference : undefined
    let fileKeys = 'fileKeys' in input ? input.fileKeys : []
    let formal = true
    const patch = async (data: Prisma.CommissionUpdateInput) => tx.commission.update({ where: { id }, data })
    switch (input.action) {
      case 'draft.update':
        await patch({ title: input.title, requirements: input.requirements }); formal = false; break
      case 'request.submit':
        await patch({ stage: 'REQUESTED', requirements: input.note }); data = { title: current.title }; break
      case 'request.accept':
        await patch({ stage: 'ACCEPTED' }); note = '管理员接受委托，开始准备合同'; break
      case 'request.return':
        await patch({ stage: 'DRAFT' }); break
      case 'submission.create': {
        if (current.paused && ['PROGRESS', 'DEMO', 'REPAIR'].includes(input.kind)) throw new HttpError('请先恢复项目', 409, 409)
        if (['PROGRESS', 'DEMO', 'REPAIR'].includes(input.kind) && (!actor.isAdmin || !['IN_PROGRESS', 'MAINTENANCE'].includes(current.stage))) throw new HttpError('当前不能发布成果或进展', 403, 403)
        if (input.kind === 'REPAIR' && current.stage !== 'MAINTENANCE') throw new HttpError('修复交付须在维护期内提交', 409, 409)
        if (input.progress !== undefined) {
          if (!actor.isAdmin || input.kind !== 'PROGRESS' || current.stage !== 'IN_PROGRESS') throw new HttpError('只能在实施阶段更新进度', 403, 403)
          await patch({ progress: input.progress, progressNote: input.note })
        }
        data = { kind: input.kind, ...(input.progress === undefined ? {} : { progress: input.progress }) }; break
      }
      case 'payment.update':
        if (input.percent < current.paymentPercent && !input.note) throw new HttpError('调低支付比例必须填写原因', 400, 400)
        data = { before: current.paymentPercent, after: input.percent }; note ||= `用户支付比例调整为 ${input.percent}%`; await patch({ paymentPercent: input.percent }); break
      case 'agreement.save': {
        const template = await tx.contractTemplateVersion.findFirst({ where: { id: input.templateVersionId, format: 'SIMPLE', status: 'PUBLISHED', template: { status: 'ACTIVE' } } })
        if (!template) throw new HttpError('请选择已发布模板', 400, 400)
        const previous = input.id ? await tx.commissionAgreement.findFirst({ where: { id: input.id, commissionId: id, status: 'DRAFT' } }) : null
        if (input.id && !previous) throw new HttpError('仅草稿可以修改', 409, 409)
        if (input.kind === 'AGREEMENT' && loaded.agreements.some((item) => item.kind === 'AGREEMENT' && item.status === 'CONFIRMED')) throw new HttpError('合同已确认，请建立补充协议', 409, 409)
        if (input.kind === 'SUPPLEMENT' && !loaded.agreements.some((item) => item.kind === 'AGREEMENT' && item.status === 'CONFIRMED')) throw new HttpError('先确认主合同', 409, 409)
        await snapshotFiles(tx, id, actor, fileKeys)
        const version = simpleVersionDto(template)
        const values = { ...input.values, 项目名称: current.title, 合同金额: input.totalFen === null ? '另行约定' : formatFen(input.totalFen), 维护天数: String(input.maintenanceDays), 确认方式: input.confirmationMode === 'ONLINE' ? '用户在线确认' : '双方线下确认，由管理员上传依据' }
        const body = templateInput(() => renderSimpleTemplate(version.body, version.fields, values))
        const value = { title: input.title, kind: input.kind, body, templateJson: JSON.stringify(version), valuesJson: JSON.stringify(values), fileKeysJson: JSON.stringify(fileKeys), totalFen: input.totalFen === null ? null : BigInt(input.totalFen), maintenanceDays: input.maintenanceDays, confirmationMode: input.confirmationMode }
        if (previous) await tx.commissionAgreement.update({ where: { id: previous.id }, data: value })
        else await tx.commissionAgreement.create({ data: { ...value, commissionId: id, publicId: randomUUID() } })
        formal = false; break
      }
      case 'agreement.publish': {
        const agreement = await tx.commissionAgreement.findFirst({ where: { id: input.id, commissionId: id, status: 'DRAFT' } })
        if (!agreement) throw new HttpError('合同草稿不存在', 404, 404)
        const template = JSON.parse(agreement.templateJson) as SimpleTemplateVersion
        const body = templateInput(() => renderSimpleTemplate(template.body, template.fields, JSON.parse(agreement.valuesJson), true))
        if (body !== agreement.body) throw new HttpError('合同草稿正文校验失败', 409, 409)
        if (agreement.kind === 'AGREEMENT' && !['ACCEPTED', 'CONTRACT_PENDING'].includes(current.stage)) throw new HttpError('当前阶段不能发布主合同', 409, 409)
        await tx.commissionAgreement.updateMany({ where: { commissionId: id, kind: agreement.kind, status: 'PENDING' }, data: { status: 'SUPERSEDED' } })
        fileKeys = JSON.parse(agreement.fileKeysJson)
        data = { agreement: { publicId: agreement.publicId, title: agreement.title, kind: agreement.kind, body, template, values: JSON.parse(agreement.valuesJson), totalFen: agreement.totalFen?.toString() || null, maintenanceDays: agreement.maintenanceDays, confirmationMode: agreement.confirmationMode } }
        note = `发布${agreement.kind === 'SUPPLEMENT' ? '补充协议' : '合同'}：${agreement.title}`
        const event = await appendSubmission(tx, current, actor, { commandId: input.commandId, requestHash, type: input.action, note, data, fileKeys })
        await tx.commissionAgreement.update({ where: { id: agreement.id }, data: { status: 'PENDING', publishedEventId: event.publicId } })
        if (agreement.kind === 'AGREEMENT') await patch({ stage: 'CONTRACT_PENDING' })
        formal = false; break
      }
      case 'agreement.confirm': case 'agreement.offline': case 'agreement.decline': {
        const agreement = await tx.commissionAgreement.findFirst({ where: { id: input.id, commissionId: id, status: 'PENDING', publishedEventId: input.eventId } })
        if (!agreement) throw new HttpError('合同版本已过期，请阅读最新版本', 409, 409)
        const online = input.action !== 'agreement.offline'
        if (online && (actor.isAdmin || agreement.confirmationMode !== 'ONLINE')) throw new HttpError('需要委托用户在线确认', 403, 403)
        if (!online && (!actor.isAdmin || agreement.confirmationMode !== 'OFFLINE')) throw new HttpError('此合同采用在线确认方式', 403, 403)
        const published = loaded.submissions.find((item) => item.publicId === input.eventId)
        verifySubmissionChain(loaded.submissions, current.commissionId)
        const frozen = published ? (JSON.parse(published.snapshotJson) as SubmissionSnapshot).data.agreement : null
        const actual = { publicId: agreement.publicId, title: agreement.title, kind: agreement.kind, body: agreement.body, template: JSON.parse(agreement.templateJson), values: JSON.parse(agreement.valuesJson), totalFen: agreement.totalFen?.toString() || null, maintenanceDays: agreement.maintenanceDays, confirmationMode: agreement.confirmationMode }
        if (canonicalJson(frozen) !== canonicalJson(actual)) throw new HttpError('合同与正式发布快照不一致', 409, 409)
        await snapshotFiles(tx, id, actor, JSON.parse(agreement.fileKeysJson))
        reference = input.eventId
        if (input.action === 'agreement.decline') {
          await tx.commissionAgreement.update({ where: { id: agreement.id }, data: { status: 'DECLINED' } })
          if (agreement.kind === 'AGREEMENT') await patch({ stage: 'ACCEPTED' })
        } else {
          const confirmedAt = input.action === 'agreement.offline' ? new Date(input.confirmedAt) : new Date()
          if (confirmedAt > new Date()) throw new HttpError('确认时间不能在未来', 400, 400)
          if (input.action === 'agreement.offline') {
            const proof = await snapshotFiles(tx, id, actor, fileKeys)
            if (!proof.length) throw new HttpError('请上传线下确认依据', 400, 400)
          }
          await tx.commissionAgreement.update({ where: { id: agreement.id }, data: { status: 'CONFIRMED', confirmedAt } })
          await patch({ agreementFen: agreement.totalFen, maintenanceDays: agreement.maintenanceDays, confirmationMode: agreement.confirmationMode, ...(agreement.kind === 'AGREEMENT' ? { stage: 'READY' } : {}), ...(current.maintenanceStartedAt ? { maintenanceEndsAt: new Date(current.maintenanceStartedAt.getTime() + agreement.maintenanceDays * 86400000) } : {}) })
          data = { agreementId: agreement.publicId, confirmedAt: confirmedAt.toISOString(), mode: agreement.confirmationMode }
          note = input.action === 'agreement.offline' ? `管理员记录线下确认：${input.note}` : '委托用户在线确认合同'
        }
        break
      }
      case 'project.start': await patch({ stage: 'IN_PROGRESS', startedAt: new Date() }); note = '管理员开始实施'; break
      case 'project.pause': await patch({ paused: input.paused }); data = { paused: input.paused }; break
      case 'project.terminate': await patch({ stage: 'TERMINATED', paused: false, ...(current.maintenanceStartedAt && !current.maintenanceClosedAt ? { maintenanceClosedAt: new Date(), maintenanceCloseReason: 'TERMINATED' } : {}) }); break
      case 'delivery.publish': {
        const files = await snapshotFiles(tx, id, actor, fileKeys)
        if (!files.some((file) => file.purpose === 'DELIVERY')) throw new HttpError('正式交付至少包含一个交付用途的上传文件', 400, 400)
        const now = new Date(), until = new Date(now.getTime() + current.maintenanceDays * 86400000)
        await patch({ stage: 'MAINTENANCE', progress: 100, maintenanceStartedAt: now, maintenanceEndsAt: until })
        data = { links: input.links, maintenanceStartedAt: now.toISOString(), maintenanceEndsAt: until.toISOString(), maintenanceDays: current.maintenanceDays }; break
      }
      case 'issue.create': data = { title: input.title, status: 'OPEN' }; break
      case 'issue.update': {
        const issue = issuesFromSnapshots(loaded.submissions.map((row) => JSON.parse(row.snapshotJson))).find((item) => item.id === input.issueId)
        if (!issue) throw new HttpError('问题不存在', 404, 404)
        if (!actor.isAdmin && input.status === 'RESOLVED') throw new HttpError('修复状态由管理员提交', 403, 403)
        reference = input.issueId; data = { issueId: input.issueId, before: issue.status, status: input.status }; break
      }
      case 'maintenance.close': {
        if (actor.isAdmin && !input.note.trim()) throw new HttpError('管理员关闭维护必须填写原因', 400, 400)
        const reason = actor.isAdmin ? 'ADMIN' : 'USER'
        await patch({ stage: 'COMPLETED', paused: false, maintenanceClosedAt: new Date(), maintenanceCloseReason: reason })
        data = { reason }; note ||= '用户主动关闭维护通道'; break
      }
    }
    if (formal) await appendSubmission(tx, current, actor, { commandId: input.commandId, requestHash, type: input.action, note, data, reference, fileKeys })
    await tx.commissionEvent.create({ data: { commissionId: id, actorUserId: actor.userId, commandId: input.commandId, type: input.action, note: '工作流操作', dataJson: JSON.stringify({ requestHash }) } })
  })
  return getWorkflow(id, actor)
}

export async function closeExpiredMaintenance(now = new Date()) {
  const due = await prisma.commission.findMany({ where: { workflowVersion: 2, stage: 'MAINTENANCE', maintenanceClosedAt: null, maintenanceEndsAt: { lte: now } }, select: { id: true }, take: 100 })
  for (const { id } of due) await unitOfWork.execute(async (tx) => {
    const changed = await tx.commission.updateMany({ where: { id, stage: 'MAINTENANCE', maintenanceClosedAt: null, maintenanceEndsAt: { lte: now } }, data: { stage: 'COMPLETED', paused: false, maintenanceClosedAt: now, maintenanceCloseReason: 'EXPIRED', revision: { increment: 1 }, updatedAt: now } })
    if (!changed.count) return
    const commission = await tx.commission.findUniqueOrThrow({ where: { id } })
    await appendSubmission(tx, commission, null, { commandId: `maintenance-expired:${commission.commissionId}`, requestHash: digest(commission.maintenanceEndsAt!.toISOString()), type: 'maintenance.close', note: '维护期已届满，自动关闭新的维护申请入口；未解决问题继续保留', data: { reason: 'EXPIRED', effectiveAt: commission.maintenanceEndsAt!.toISOString() }, now })
  })
  return due.length
}
