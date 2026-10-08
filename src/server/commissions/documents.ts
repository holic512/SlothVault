/**
 * @file documents.ts
 * @project SlothVault
 * @module Commission Document Snapshots
 * @description Generates agreements, change orders and acceptance forms from published template snapshots.
 * @logic Bind source records to controlled fields, freeze the complete template and values, and apply financial or acceptance effects atomically with customer signing.
 * @dependencies Prisma transactions, templates, contract evidence protocol, commission authorization
 * @index_tags commissions,contracts,signatures,changes,acceptance,snapshots
 * @author holic512
 */
import 'server-only'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { beijingDate, addCalendarDays, addWorkingDays } from '@/lib/commissions'
import type { WorkingCalendar } from '@/lib/commissions'
import { derivedTemplateValues, renderContractDocument } from '@/lib/contract-template'
import type { TemplateDocuments, TemplateField } from '@/types/commissions'
import { contractBodyHash, normalizeContractBody, partyCommitment } from '@/server/services/contract-evidence-protocol'
import { requireTemplateVersion } from './templates'
import { authorizeCommission, getCommission, jsonObject, requireAdminActor } from './service'
import type { CommissionActor } from './input'
import type { z } from 'zod'
import type { documentDraftInput } from './input'
import { assertDocumentAttachments, documentAttachment, verifyCommissionBytes } from './storage'
import type { DocumentAttachment } from './storage'
export type DocumentSnapshot = {
  templateKey: string; version: number; documents: TemplateDocuments; fields: TemplateField[]
  values: Record<string, unknown>; documentType: 'AGREEMENT' | 'CHANGE' | 'ACCEPTANCE'
  attachments?: DocumentAttachment[]
}
export function documentSnapshotHash(snapshot: string) { return createHash('sha256').update(snapshot).digest('hex') }
export function assertDocumentSnapshot(contract: { snapshotJson: string | null; snapshotHash?: string | null; body: string; commissionId?: number | null }, strict = false) {
  if (!contract.commissionId) return
  if (!contract.snapshotJson || !contract.snapshotHash || documentSnapshotHash(contract.snapshotJson) !== contract.snapshotHash) throw new HttpError('正式文件快照校验失败', 409, 409)
  const snapshot = JSON.parse(contract.snapshotJson) as DocumentSnapshot
  try {
    const expected = renderContractDocument(snapshot.documents, snapshot.fields, snapshot.values, snapshot.documentType, strict)
    if (contractBodyHash(expected) !== contractBodyHash(contract.body)) throw new HttpError('模板数据与冻结正文不一致', 409, 409)
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(error instanceof Error ? error.message : '模板数据校验失败', 400, 400) }
}
export async function createCommissionDocument(id: number, actor: CommissionActor, input: z.infer<typeof documentDraftInput>) {
  requireAdminActor(actor)
  const template = await requireTemplateVersion(input.templateVersionId)
  if (template.status !== 'PUBLISHED' || template.templateStatus !== 'ACTIVE') throw new HttpError('请选择启用模板的已发布版本', 400, 400)
  await unitOfWork.execute(async (tx) => {
    const commission = await authorizeCommission(tx, id, actor)
    const duplicate = await tx.commissionEvent.findUnique({ where: { commissionId_commandId: { commissionId: id, commandId: input.commandId } } })
    if (duplicate) { if (duplicate.actorUserId !== actor.userId || duplicate.type !== 'DOCUMENT_DRAFT') throw new HttpError('请求标识已用于其他操作', 409, 409); return }
    const changed = await tx.commission.updateMany({ where: { id, revision: input.revision }, data: { revision: { increment: 1 }, updatedAt: new Date() } })
    if (changed.count !== 1) throw new HttpError('项目已更新，请刷新后重试', 409, 409)
    const existing = input.documentId ? await tx.contract.findFirst({ where: { id: input.documentId, commissionId: id, status: 0, documentType: input.documentType } }) : null
    if (input.documentId && !existing) throw new HttpError('只有当前项目的草稿文件可以修改', 409, 409)
    if (input.documentType === 'AGREEMENT' && await tx.contract.count({ where: { commissionId: id, documentType: 'AGREEMENT', status: { in: [0, 1, 2] }, ...(existing ? { id: { not: existing.id } } : {}) } })) throw new HttpError('正文与附件一已有有效文件，请编辑草稿或使用变更确认单', 409, 409)
    const agreement = await tx.contract.findFirst({ where: { commissionId: id, documentType: 'AGREEMENT', status: 2 }, orderBy: { id: 'desc' } })
    const previousValues = agreement ? (jsonObject(agreement.snapshotJson).values as Record<string, unknown> || {}) : {}
    const partyA = jsonObject(commission.partyAJson), partyB = jsonObject(commission.partyBJson)
    const parties = { ...Object.fromEntries(['Name', 'Identity', 'Phone', 'Email', 'Wechat', 'Address'].flatMap((key) => [['partyA' + key, partyA[key] || ''], ['partyB' + key, partyB[key] || '']])), payee: partyB.payeeName, payeeAccount: partyB.payeeAccount, payeePlatform: partyB.paymentChannel, supportChannel: partyB.supportChannel }
    const values: Record<string, unknown> = { ...template.defaults, ...parties, ...previousValues, contractNumber: commission.commissionId, projectName: commission.title, purpose: commission.purpose, ...(commission.quotationFen === null ? {} : { totalFen: commission.quotationFen.toString() }), contractDate: beijingDate(new Date()), requirementsDate: beijingDate(new Date()), ...input.values }
    if (input.documentType !== 'AGREEMENT' && !agreement) throw new HttpError('请先完成正文与需求附件签约', 409, 409)
    if (input.documentType !== 'AGREEMENT' && !input.sourceRecordId) throw new HttpError('请选择对应变更或验收记录', 400, 400)
    if (input.sourceRecordId && await tx.contract.count({ where: { commissionId: id, documentType: input.documentType, sourceRecordId: input.sourceRecordId, status: { in: [0, 1, 2] }, ...(existing ? { id: { not: existing.id } } : {}) } })) throw new HttpError('该记录已有确认单，请编辑原草稿', 409, 409)
    if (input.documentType === 'CHANGE') {
      const change = await tx.commissionChange.findFirst({ where: { id: input.sourceRecordId, commissionId: id, status: 'QUOTED' } })
      if (!change) throw new HttpError('请先完成变更报价', 409, 409)
      Object.assign(values, { projectName: previousValues.projectName || commission.title, changeNumber: `${commission.commissionId}-C${change.id}`, changeDate: beijingDate(change.createdAt), original: change.original, proposed: change.proposed, changeReason: change.reason, changeFen: change.feeFen.toString(), extensionDays: change.extensionDays, impact: change.impact })
    }
    if (input.documentType === 'ACCEPTANCE') {
      const acceptance = await tx.commissionAcceptance.findFirst({ where: { id: input.sourceRecordId, commissionId: id, status: 'DRAFT' }, include: { delivery: { include: { items: { orderBy: { id: 'asc' } } } } } })
      if (!acceptance) throw new HttpError('验收记录不存在或已发起', 409, 409)
      Object.assign(values, { projectName: previousValues.projectName || commission.title, deliveryVersion: acceptance.delivery.version, deliveryManifest: JSON.parse(acceptance.delivery.manifestJson), acceptanceDate: beijingDate(acceptance.createdAt), deliveredContent: acceptance.delivery.items.map((i) => i.label).join('；'), acceptanceBasis: acceptance.basis, outstanding: acceptance.outstanding || '无', acceptanceResult: acceptance.result })
    }
    if (input.documentType === 'AGREEMENT') { values.projectName = String(values.projectName || '').trim(); values.purpose = String(values.purpose || '').trim() }
    const availableFiles = await tx.commissionFile.findMany({ where: { commissionId: id, shared: true, purpose: { in: ['REQUIREMENT', 'TEST'] }, file: { status: 1 } }, include: { file: true }, orderBy: { id: 'asc' } })
    const previousAttachments = existing ? (JSON.parse(existing.snapshotJson!) as DocumentSnapshot).attachments : undefined
    const attachments = input.attachmentFileIds === undefined ? previousAttachments || availableFiles.filter((f) => f.purpose === 'REQUIREMENT').map(documentAttachment) : input.attachmentFileIds.map((fileId) => {
      const file = availableFiles.find((f) => f.id === fileId)
      if (!file) throw new HttpError('关联资料须为本项目已共享的需求或测试资料', 400, 400)
      return documentAttachment(file)
    })
    assertDocumentAttachments(attachments, availableFiles)
    const snapshot: DocumentSnapshot = { templateKey: template.templateKey, version: template.version, documents: template.documents, fields: template.fields, values: derivedTemplateValues(values), documentType: input.documentType, attachments }
    let body: string
    try { body = normalizeContractBody(renderContractDocument(snapshot.documents, snapshot.fields, snapshot.values, input.documentType)) }
    catch (error) { throw new HttpError(error instanceof Error ? error.message : '模板生成失败', 400, 400) }
    if (input.documentType === 'AGREEMENT') {
      const title = String(values.projectName || '').trim(), purpose = String(values.purpose || '').trim()
      if (!title || title.length > 255 || !purpose) throw new HttpError('请填写有效的项目名称和用途', 400, 400)
      const partySnapshot = (prefix: string, current: Record<string, unknown>) => ({ ...current, ...Object.fromEntries(['Name', 'Identity', 'Phone', 'Email', 'Wechat', 'Address'].map((key) => [key, values[prefix + key] || ''])) })
      await tx.commission.update({ where: { id }, data: { title, purpose, quotationFen: values.totalFen === undefined || values.totalFen === '' ? undefined : BigInt(String(values.totalFen)), partyAJson: JSON.stringify(partySnapshot('partyA', partyA)), partyBJson: JSON.stringify({ ...partySnapshot('partyB', partyB), payeeName: values.payee || '', payeeAccount: values.payeeAccount || '', paymentChannel: values.payeePlatform || '', supportChannel: values.supportChannel || '' }) } })
    }
    const contractId = existing?.contractId || randomUUID(), snapshotJson = JSON.stringify(snapshot)
    const data = { templateVersionId: input.templateVersionId, documentType: input.documentType, sourceRecordId: input.sourceRecordId || null, snapshotJson, snapshotHash: documentSnapshotHash(snapshotJson), body, bodyHash: contractBodyHash(body), title: `${values.projectName} · ${{ AGREEMENT: '软件定制开发服务合同', CHANGE: '需求变更确认单', ACCEPTANCE: '项目验收确认单' }[input.documentType]}`.slice(0, 255) }
    const contract = existing ? await tx.contract.update({ where: { id: existing.id, status: 0, updatedAt: existing.updatedAt }, data: { ...data, updatedAt: new Date(), adminAudits: { create: { actorUserId: actor.userId, action: 'DRAFT_UPDATED' } } } }) : await tx.contract.create({ data: { ...data, contractId, commissionId: id, issuerUserId: actor.userId, subjectUserId: commission.subjectUserId, partyCommitment: partyCommitment({ contractId, subjectUserId: commission.subjectUserId, nonce: randomBytes(32).toString('hex') }), adminAudits: { create: { actorUserId: actor.userId, action: 'DRAFT_CREATED' } } } })
    await tx.commissionEvent.create({ data: { commissionId: id, actorUserId: actor.userId, commandId: input.commandId, type: 'DOCUMENT_DRAFT', note: `${existing ? '修改' : '生成'}正式文件草稿：${data.title}`, dataJson: JSON.stringify({ contractId: contract.id, templateKey: snapshot.templateKey, version: snapshot.version }) } })
  })
  return getCommission(id, actor)
}
export async function issueCommissionDocument(contractId: number, actor: CommissionActor) {
  requireAdminActor(actor)
  return unitOfWork.execute(async (tx) => {
    const contract = await tx.contract.findUnique({ where: { id: contractId } })
    if (!contract?.commissionId || contract.status !== 0) throw new HttpError('文件不是可发起的委托草稿', 409, 409)
    const commission = await authorizeCommission(tx, contract.commissionId, actor)
    assertDocumentSnapshot(contract, true)
    const snapshot = JSON.parse(contract.snapshotJson!) as DocumentSnapshot
    const files = await tx.commissionFile.findMany({ where: { commissionId: contract.commissionId }, include: { file: true } })
    for (const file of assertDocumentAttachments(snapshot.attachments || [], files)) await verifyCommissionBytes(file)
    if (contract.documentType === 'AGREEMENT' && (snapshot.values.projectName !== commission.title || snapshot.values.purpose !== commission.purpose || String(snapshot.values.totalFen) !== commission.quotationFen?.toString())) throw new HttpError('项目名称、用途或报价已调整，请重新保存合同草稿', 409, 409)
    const installation = await tx.systemInstallation.findFirst({ orderBy: { id: 'asc' }, select: { installationId: true } })
    if (!installation) throw new HttpError('System installation identity is missing', 409, 409)
    if (contract.documentType === 'CHANGE') {
      const change = await tx.commissionChange.findFirst({ where: { id: contract.sourceRecordId!, commissionId: contract.commissionId, status: 'QUOTED' } })
      if (!change) throw new HttpError('变更报价已变化，请重新生成确认单', 409, 409)
      const values = (JSON.parse(contract.snapshotJson!) as DocumentSnapshot).values
      if (values.changeFen !== change.feeFen.toString() || values.extensionDays !== change.extensionDays || values.impact !== change.impact || values.original !== change.original || values.proposed !== change.proposed || values.changeReason !== change.reason) throw new HttpError('变更报价与草稿不一致，请重新生成', 409, 409)
      await tx.commissionChange.update({ where: { id: change.id }, data: { status: 'PENDING_SIGNATURE' } })
    }
    if (contract.documentType === 'ACCEPTANCE') {
      const count = await tx.commissionAcceptance.updateMany({ where: { id: contract.sourceRecordId!, commissionId: contract.commissionId, status: 'DRAFT' }, data: { status: 'SUBMITTED' } })
      if (count.count !== 1) throw new HttpError('验收记录已变化', 409, 409)
    }
    const now = new Date()
    const changed = await tx.contract.updateMany({ where: { id: contract.id, status: 0, updatedAt: contract.updatedAt }, data: { status: 1, issuedAt: now, installationId: installation.installationId, providerSessionId: actor.sessionId || null, providerIp: actor.ip || null, providerUserAgent: actor.userAgent || null, updatedAt: now } })
    if (changed.count !== 1) throw new HttpError('文件已更新，请刷新', 409, 409)
    await tx.contractAdminAudit.create({ data: { contractId, actorUserId: actor.userId, action: 'ISSUED' } })
    await tx.commission.update({ where: { id: contract.commissionId }, data: { revision: { increment: 1 }, updatedAt: now } })
    await tx.commissionEvent.create({ data: { commissionId: contract.commissionId, actorUserId: actor.userId, commandId: randomUUID(), type: 'DOCUMENT_ISSUED', note: '开发方确认冻结文件并邀请客户本人签署', dataJson: JSON.stringify({ contractId }) } })
    return contract.commissionId
  })
}
export async function applyCommissionSignature(tx: Prisma.TransactionClient, contract: { id: number; commissionId: number | null; documentType: string; sourceRecordId: number | null; snapshotJson: string | null; subjectUserId: number }, signedAt: Date) {
  if (!contract.commissionId) return
  const id = contract.commissionId, snapshot = JSON.parse(contract.snapshotJson!) as DocumentSnapshot, values = snapshot.values
  const commission = await tx.commission.findUniqueOrThrow({ where: { id } })
  const files = await tx.commissionFile.findMany({ where: { commissionId: id }, include: { file: true } })
  for (const file of assertDocumentAttachments(snapshot.attachments || [], files)) await verifyCommissionBytes(file)
  if (contract.documentType === 'AGREEMENT') {
    if (commission.agreementFen !== null) throw new HttpError('项目已有生效合同', 409, 409)
    await tx.commission.update({ where: { id }, data: { agreementFen: BigInt(String(values.totalFen)), quotationFen: BigInt(String(values.totalFen)), adjustmentDays: Number(values.adjustmentDays), maintenanceDays: Number(values.maintenanceDays), expectedDeliveryAt: typeof values.deliveryDate === 'string' ? new Date(`${values.deliveryDate}T23:59:59+08:00`) : undefined } })
    await tx.commissionPaymentPlan.createMany({ data: [
      { commissionId: id, key: 'START', kind: 'START', title: '项目启动款', amountFen: BigInt(String(values.startFen)), basis: '合同生效、需求范围确认后支付' },
      { commissionId: id, key: 'PROGRESS', kind: 'PROGRESS', title: '开发进度款', amountFen: BigInt(String(values.progressFen)), basis: '完成主要功能并提供可查看或测试的阶段成果后支付' },
      { commissionId: id, key: 'FINAL', kind: 'FINAL', title: '项目验收尾款', amountFen: BigInt(String(values.finalFen)), basis: '验收通过且在完整交付前支付' },
    ] })
  } else if (contract.documentType === 'CHANGE') {
    const change = await tx.commissionChange.findFirst({ where: { id: contract.sourceRecordId!, commissionId: id, status: 'PENDING_SIGNATURE' } })
    if (!change) throw new HttpError('变更已确认或记录不一致', 409, 409)
    await tx.commissionChange.update({ where: { id: change.id }, data: { status: 'CONFIRMED', confirmedAt: signedAt } })
    if (change.feeFen > 0n) await tx.commissionPaymentPlan.create({ data: { commissionId: id, key: `CHANGE-${change.id}`, kind: 'CHANGE', title: `变更款：${change.title}`.slice(0, 255), amountFen: change.feeFen, basis: '双方确认的需求变更费用' } })
    if (commission.expectedDeliveryAt) {
      const agreement = await tx.contract.findFirst({ where: { commissionId: id, documentType: 'AGREEMENT', status: 2 } })
      const terms = agreement?.snapshotJson ? JSON.parse(agreement.snapshotJson) as DocumentSnapshot : null
      const settings = await tx.commissionSettings.findUnique({ where: { id: 1 } })
      const calendar = jsonObject(settings?.calendarJson || '{}') as WorkingCalendar
      await tx.commission.update({ where: { id }, data: { expectedDeliveryAt: terms?.values.durationUnit === '工作日' ? addWorkingDays(commission.expectedDeliveryAt, change.extensionDays, calendar) : addCalendarDays(commission.expectedDeliveryAt, change.extensionDays) } })
    }
  } else if (contract.documentType === 'ACCEPTANCE') {
    const acceptance = await tx.commissionAcceptance.findFirst({ where: { id: contract.sourceRecordId!, commissionId: id } })
    if (!acceptance || !['SUBMITTED', 'DEEMED'].includes(acceptance.status)) throw new HttpError('验收记录已处理或不一致', 409, 409)
    await tx.commissionAcceptance.update({ where: { id: acceptance.id }, data: { status: 'CONFIRMED', confirmedAt: acceptance.confirmedAt || signedAt } })
    if (acceptance.result !== 'FAIL' && !commission.acceptedAt) await tx.commission.update({ where: { id }, data: { acceptedAt: signedAt } })
  }
  await tx.commission.update({ where: { id }, data: { revision: { increment: 1 }, updatedAt: signedAt } })
  await tx.commissionEvent.create({ data: { commissionId: id, actorUserId: contract.subjectUserId, commandId: `signature-${contract.id}`, type: 'DOCUMENT_SIGNED', note: '客户本人确认正式文件', dataJson: JSON.stringify({ contractId: contract.id, documentType: contract.documentType, signedAt: signedAt.toISOString() }) } })
}
export async function endCommissionDocument(tx: Prisma.TransactionClient, contract: { id: number; commissionId?: number | null; documentType?: string; sourceRecordId?: number | null }, actorUserId: number, action: 'DECLINED' | 'CANCELLED', reason = '') {
  if (!contract.commissionId) return
  if (contract.documentType === 'CHANGE' && contract.sourceRecordId) await tx.commissionChange.updateMany({ where: { id: contract.sourceRecordId, commissionId: contract.commissionId, status: { not: 'CONFIRMED' } }, data: { status: action === 'DECLINED' ? 'REJECTED' : 'QUOTED' } })
  if (contract.documentType === 'ACCEPTANCE' && contract.sourceRecordId) await tx.commissionAcceptance.updateMany({ where: { id: contract.sourceRecordId, commissionId: contract.commissionId, status: { in: ['DRAFT', 'SUBMITTED'] } }, data: { status: action === 'DECLINED' ? 'REJECTED' : 'CANCELLED' } })
  await tx.commission.update({ where: { id: contract.commissionId }, data: { revision: { increment: 1 }, updatedAt: new Date() } })
  await tx.commissionEvent.create({ data: { commissionId: contract.commissionId, actorUserId, commandId: `${action.toLowerCase()}-${contract.id}`, type: `DOCUMENT_${action}`, note: action === 'DECLINED' ? `客户拒绝文件确认：${reason}` : '开发方取消文件发起', dataJson: JSON.stringify({ contractId: contract.id, reason }) } })
}
