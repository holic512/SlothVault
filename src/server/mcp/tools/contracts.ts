/**
 * @file contracts.ts
 * @project SlothVault
 * @module Administrator MCP Commissions
 * @description Queries private commissions and manages requests, progress and template-based drafts.
 * @logic Bind the principal, use revision and idempotency guards, and leave formal commitments to the web workspace.
 * @dependencies MCP registry, commission services, published templates
 * @index_tags mcp,commissions,templates,drafts
 * @author holic512
 */
import 'server-only'
import { z } from 'zod'
import { collectMcpToolDefinitions } from '@/server/mcp/registry'
import { createCommission, executeCommissionCommand, getCommission, listCommissions } from '@/server/commissions/service'
import { createCommissionDocument } from '@/server/commissions/documents'
import { listContractTemplates } from '@/server/commissions/templates'
import { moneyInput } from '@/server/commissions/input'
import { COMMISSION_STAGES } from '@/lib/commissions'
import { decimalIdSchema, isoDateSchema, mcpId, pageSchema, pageSizeSchema, paginationOutputShape, READ_ONLY_ANNOTATIONS, IDEMPOTENT_CREATE_ANNOTATIONS, IDEMPOTENT_UPDATE_ANNOTATIONS, runMcpTool } from './common'
const stages = z.enum(Object.keys(COMMISSION_STAGES) as [keyof typeof COMMISSION_STAGES, ...Array<keyof typeof COMMISSION_STAGES>])
const base = { commandId: z.string().uuid().describe('重试保持同一 UUID。'), revision: z.number().int().nonnegative().describe('从最新详情读取。') }
const party = z.record(z.string().max(40), z.string().max(1000))
const summary = z.object({ id: decimalIdSchema, commissionId: z.string(), title: z.string(), subjectUserId: decimalIdSchema, stage: stages, progress: z.number().int(), revision: z.number().int(), progressNote: z.string(), paymentSummary: z.string(), quotationFen: moneyInput.nullable(), totalFen: moneyInput.nullable(), expectedDeliveryAt: isoDateSchema.nullable(), todos: z.array(z.object({ key: z.string(), audience: z.enum(['ADMIN', 'USER', 'BOTH']), text: z.string(), dueAt: isoDateSchema.nullable().optional() })), warnings: z.array(z.string()) })
const detail = summary.extend({ purpose: z.string(), requirements: z.string(), documents: z.array(z.object({ id: decimalIdSchema, title: z.string(), documentType: z.string(), status: z.number().int(), body: z.string(), bodyHash: z.string(), contractHash: z.string().nullable(), sourceRecordId: decimalIdSchema.nullable(), templateVersionId: decimalIdSchema.nullable() })), files: z.array(z.object({ id: decimalIdSchema, purpose: z.string(), sha256: z.string(), shared: z.boolean(), originalName: z.string(), fileSize: z.string() })), plans: z.array(z.object({ id: decimalIdSchema, kind: z.string(), title: z.string(), amountFen: moneyInput, netFen: z.string(), remainingFen: moneyInput, status: z.string() })), changes: z.array(z.object({ id: decimalIdSchema, title: z.string(), original: z.string(), proposed: z.string(), feeFen: moneyInput, extensionDays: z.number().int(), status: z.string() })), deliveries: z.array(z.object({ id: decimalIdSchema, version: z.string(), kind: z.string(), status: z.string() })), acceptances: z.array(z.object({ id: decimalIdSchema, deliveryId: decimalIdSchema, result: z.string(), status: z.string(), basis: z.string(), outstanding: z.string() })) })
export const contractToolDefinitions = collectMcpToolDefinitions((server) => {
  server.defineTool('admin.commission.list', {
    title: '查询委托项目', description: '查询客户项目阶段、进度、付款事实与待办。委托与公开文档项目独立。',
    inputSchema: z.strictObject({ page: pageSchema, pageSize: pageSizeSchema, keyword: z.string().max(255).optional(), stage: stages.optional() }), outputSchema: z.object({ list: z.array(summary), ...paginationOutputShape }), annotations: READ_ONLY_ANNOTATIONS,
  }, async (input, { principal }) => runMcpTool('admin.commission.list', () => listCommissions({ userId: principal.userId, isAdmin: true }, input)))
  server.defineTool('admin.commission.get', {
    title: '读取委托履约详情', description: '读取最新 revision、需求、文件正文、账款、变更、验收、交付和私有文件元数据。文件字节在所属委托网页授权下载。',
    inputSchema: z.strictObject({ commissionId: decimalIdSchema }), outputSchema: detail, annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ commissionId }, { principal }) => runMcpTool('admin.commission.get', () => getCommission(mcpId(commissionId, 'commissionId'), { userId: principal.userId, isAdmin: true })))
  server.defineTool('admin.commission.create', {
    title: '建立客户委托', description: '先用 admin.user.list 核对启用普通客户账户，再代建需求工作台。金额为分的整数；不会发起合同或确认收款。',
    inputSchema: z.strictObject({ commandId: base.commandId, subjectUserId: decimalIdSchema, title: z.string().trim().min(1).max(255), purpose: z.string().min(1).max(10000), requirements: z.string().min(1).max(10000), quotationFen: moneyInput.optional(), partyA: party.optional() }), outputSchema: detail, annotations: IDEMPOTENT_CREATE_ANNOTATIONS,
  }, async ({ subjectUserId, ...input }, { principal }) => runMcpTool('admin.commission.create', () => createCommission({ userId: principal.userId, isAdmin: true }, { ...input, subjectUserId: mcpId(subjectUserId, 'subjectUserId') })))
  server.defineTool('admin.commission.update', {
    title: '编辑需求与报价', description: '以最新 revision 编辑需求、未签约报价及双方资料。已签约金额通过网页变更确认。',
    inputSchema: z.strictObject({ ...base, commissionId: decimalIdSchema, title: z.string().trim().min(1).max(255).optional(), purpose: z.string().max(10000).optional(), requirements: z.string().max(10000).optional(), quotationFen: moneyInput.optional(), partyA: party.optional(), partyB: party.optional() }), outputSchema: detail, annotations: IDEMPOTENT_UPDATE_ANNOTATIONS,
  }, async ({ commissionId, ...input }, { principal }) => runMcpTool('admin.commission.update', () => executeCommissionCommand(mcpId(commissionId, 'commissionId'), { userId: principal.userId, isAdmin: true }, { ...input, action: 'update' })))
  server.defineTool('admin.commission.progress.update', {
    title: '维护阶段与进度', description: '按实际业务自由调整阶段、进度和日期。跨阶段、回退、暂停、终止须填写 reason。不会产生到账、签署、验收或接收记录。',
    inputSchema: z.strictObject({ ...base, commissionId: decimalIdSchema, stage: stages, progress: z.number().int().min(0).max(100), note: z.string().max(10000), reason: z.string().max(10000).default(''), expectedDeliveryAt: z.iso.datetime({ offset: true }).nullable().optional() }), outputSchema: detail, annotations: IDEMPOTENT_UPDATE_ANNOTATIONS,
  }, async ({ commissionId, ...input }, { principal }) => runMcpTool('admin.commission.progress.update', () => executeCommissionCommand(mcpId(commissionId, 'commissionId'), { userId: principal.userId, isAdmin: true }, { ...input, action: 'stage' })))
  server.defineTool('admin.commission.document.draft.create', {
    title: '按模板生成文件草稿', description: '以发布模板及 values 生成正文与附件一、实际变更或验收确认单。sourceRecordId 须属于委托。草稿在网页预览后正式发起；签署、到账、退款及正式交付均在网页完成。',
    inputSchema: z.strictObject({ ...base, commissionId: decimalIdSchema, templateVersionId: decimalIdSchema, documentType: z.enum(['AGREEMENT', 'CHANGE', 'ACCEPTANCE']), sourceRecordId: decimalIdSchema.optional(), documentId: decimalIdSchema.optional(), values: z.record(z.string().max(100), z.json()) }), outputSchema: detail, annotations: IDEMPOTENT_CREATE_ANNOTATIONS,
  }, async ({ commissionId, templateVersionId, sourceRecordId, documentId, ...input }, { principal }) => runMcpTool('admin.commission.document.draft.create', () => createCommissionDocument(mcpId(commissionId, 'commissionId'), { userId: principal.userId, isAdmin: true }, { ...input, templateVersionId: mcpId(templateVersionId, 'templateVersionId'), sourceRecordId: sourceRecordId ? mcpId(sourceRecordId, 'sourceRecordId') : undefined, documentId: documentId ? mcpId(documentId, 'documentId') : undefined })))
  server.defineTool('admin.contract-template.list', {
    title: '查询模板及发布版本', description: '读取启用状态、发布版本、正文及字段定义供草稿填写。模板编辑和发布在网页完成。',
    inputSchema: z.strictObject({}), outputSchema: z.object({ templates: z.array(z.object({ id: decimalIdSchema, key: z.string(), name: z.string(), status: z.string(), versions: z.array(z.object({ id: decimalIdSchema, templateId: decimalIdSchema, version: z.number().int(), status: z.string(), documents: z.object({ AGREEMENT: z.string(), REQUIREMENTS: z.string(), CHANGE: z.string(), ACCEPTANCE: z.string() }), fields: z.array(z.json()), defaults: z.record(z.string().max(100), z.json()) })) })) }), annotations: READ_ONLY_ANNOTATIONS,
  }, async () => runMcpTool('admin.contract-template.list', async () => ({ templates: await listContractTemplates() })))
})
