/**
 * @file contracts.ts
 * @project SlothVault
 * @module MCP Commission Draft Tools
 * @description Reads workflow facts and edits unpublished commission and agreement drafts.
 * @logic Keep formal submissions, account confirmation, payment changes and wallet evidence inside authenticated web workflows.
 * @dependencies workflow services, MCP registry, zod
 * @index_tags mcp,commissions,templates,drafts
 * @author holic512
 */
import 'server-only'
import { z } from 'zod'
import { collectMcpToolDefinitions } from '@/server/mcp/registry'
import { createWorkflow, executeWorkflowCommand, getWorkflow, listWorkflows } from '@/server/commissions/workflow'
import { listSimpleTemplates } from '@/server/commissions/simple-templates'
import { workflowCommandInput } from '@/server/commissions/workflow-input'
import { decimalIdSchema, mcpId, pageSchema, pageSizeSchema, paginationOutputShape, READ_ONLY_ANNOTATIONS, IDEMPOTENT_CREATE_ANNOTATIONS, IDEMPOTENT_UPDATE_ANNOTATIONS, runMcpTool } from './common'
const base = { commandId: z.string().uuid(), revision: z.number().int().nonnegative() }
const summary = z.object({ id: decimalIdSchema, publicId: z.string(), title: z.string(), subject: z.string().nullable(), stage: z.string(), paused: z.boolean(), paymentPercent: z.number().int(), updatedAt: z.string(), bindingStatus: z.string(), nextAction: z.string(), archived: z.boolean() })
const detail = summary.extend({ revision: z.number().int(), requirements: z.string(), totalFen: z.string().nullable(), progress: z.number().int(), confirmationMode: z.string(), maintenanceDays: z.number().int(), maintenanceStartedAt: z.string().nullable(), maintenanceEndsAt: z.string().nullable(), maintenanceClosedAt: z.string().nullable(), maintenanceCloseReason: z.string(), allowedActions: z.array(z.string()), events: z.array(z.json()), agreements: z.array(z.json()), files: z.array(z.json()), issues: z.array(z.json()) })
export const contractToolDefinitions = collectMcpToolDefinitions((server) => {
  server.defineTool('admin.commission.list', {
    title: '查询委托项目', description: '查询独立的生命周期、用户支付比例、认领状态与待办。',
    inputSchema: z.strictObject({ page: pageSchema, pageSize: pageSizeSchema, keyword: z.string().max(255).optional(), stage: z.string().max(40).optional() }), outputSchema: z.object({ list: z.array(summary), ...paginationOutputShape }), annotations: READ_ONLY_ANNOTATIONS,
  }, async (input, { principal }) => runMcpTool('admin.commission.list', () => listWorkflows({ userId: principal.userId, isAdmin: true }, input)))
  server.defineTool('admin.commission.get', {
    title: '读取委托履约详情', description: '读取最新 revision、冻结时间轴、合同版本、私有文件元数据及维护记录。',
    inputSchema: z.strictObject({ commissionId: decimalIdSchema }), outputSchema: detail, annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ commissionId }, { principal }) => runMcpTool('admin.commission.get', () => getWorkflow(mcpId(commissionId, 'commissionId'), { userId: principal.userId, isAdmin: true })))
  server.defineTool('admin.commission.create', {
    title: '建立委托草稿', description: '指定启用的普通用户或保留待邀请状态。只建立草稿，不正式提交。',
    inputSchema: z.strictObject({ commandId: base.commandId, subjectUserId: decimalIdSchema.optional(), title: z.string().min(1).max(255), requirements: z.string().max(10000).default('') }), outputSchema: detail, annotations: IDEMPOTENT_CREATE_ANNOTATIONS,
  }, async ({ subjectUserId, ...input }, { principal }) => runMcpTool('admin.commission.create', () => createWorkflow({ userId: principal.userId, isAdmin: true }, { ...input, subjectUserId: subjectUserId ? mcpId(subjectUserId, 'subjectUserId') : undefined, draft: true })))
  server.defineTool('admin.commission.update', {
    title: '编辑委托草稿', description: '仅编辑草稿阶段的名称和需求；已正式提交的内容只能在网页追加新记录。',
    inputSchema: z.strictObject({ ...base, commissionId: decimalIdSchema, title: z.string().min(1).max(255), requirements: z.string().max(10000) }), outputSchema: detail, annotations: IDEMPOTENT_UPDATE_ANNOTATIONS,
  }, async ({ commissionId, ...input }, { principal }) => runMcpTool('admin.commission.update', () => executeWorkflowCommand(mcpId(commissionId, 'commissionId'), { userId: principal.userId, isAdmin: true }, { ...input, action: 'draft.update' })))
  server.defineTool('admin.commission.document.draft.create', {
    title: '生成合同草稿', description: '选择已发布Markdown模板，填写变量、合同金额与维护天数。发布和确认在网页完成。',
    inputSchema: z.strictObject({ ...base, commissionId: decimalIdSchema, templateVersionId: decimalIdSchema, title: z.string().min(1).max(255), kind: z.enum(['AGREEMENT', 'SUPPLEMENT']).default('AGREEMENT'), values: z.record(z.string(), z.union([z.string(), z.number()])), totalFen: z.string().nullable(), maintenanceDays: z.number().int().min(1).max(3650).default(15), confirmationMode: z.enum(['ONLINE', 'OFFLINE']).default('ONLINE') }), outputSchema: detail, annotations: IDEMPOTENT_CREATE_ANNOTATIONS,
  }, async ({ commissionId, templateVersionId, ...input }, { principal }) => runMcpTool('admin.commission.document.draft.create', () => executeWorkflowCommand(mcpId(commissionId, 'commissionId'), { userId: principal.userId, isAdmin: true }, workflowCommandInput.parse({ ...input, action: 'agreement.save', templateVersionId: mcpId(templateVersionId, 'templateVersionId'), fileKeys: [] }))))
  server.defineTool('admin.contract-template.list', {
    title: '查询Markdown模板', description: '读取模板发布版本、正文与自动识别的变量。编辑与发布在网页完成。',
    inputSchema: z.strictObject({}), outputSchema: z.object({ templates: z.array(z.json()) }), annotations: READ_ONLY_ANNOTATIONS,
  }, async () => runMcpTool('admin.contract-template.list', async () => ({ templates: await listSimpleTemplates() })))
})
