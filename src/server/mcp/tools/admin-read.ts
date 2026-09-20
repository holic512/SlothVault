/**
 * @file admin-read.ts
 * @project SlothVault
 * @module MCP Administrator Read Tools
 * @description Registers safe administrator read tools for accounts, membership, points, contracts, evidence, settings, dashboard, and release status.
 * @logic Delegate all reads to existing services, keep sensitive values masked by their source DTOs, and never expose mutation handlers through this registry.
 * @dependencies MCP TypeScript SDK, zod, administrator services, MCP tool contracts
 * @index_tags mcp,tools,admin,read-only,dashboard,users,contracts,evidence
 * @author MengJiaXu
 */
import 'server-only'

import { z } from 'zod'

import { collectMcpToolDefinitions, type McpToolDefinition } from '@/server/mcp/registry'

import { HttpError } from '@/server/http/errors'
import { getAdminDashboard } from '@/server/services/admin-dashboard'
import { getAdminContract, listAdminContracts } from '@/server/services/contracts'
import { listAdminSettings } from '@/server/services/admin-settings'
import {
  getManagedUser,
  listGiftCardBatches,
  listUserPointTransactions,
  listUsers,
} from '@/server/services/points'
import { getAdminReleaseEvidence, listReleaseEvidence } from '@/server/services/release-evidence'
import { getSystemUpdateInfo } from '@/server/services/system-update'
import { getManagedUserMembership, listMembershipLevels } from '@/server/services/membership'

import {
  decimalIdSchema,
  isoDateSchema,
  jsonObjectSchema,
  mcpId,
  pageSchema,
  pageSizeSchema,
  paginatedListSchema,
  paginationOutputShape,
  READ_ONLY_ANNOTATIONS,
  runMcpTool,
} from './common'

const membershipSummarySchema = z.object({
  id: decimalIdSchema,
  name: z.string(),
  rank: z.number().int(),
  expiresAt: isoDateSchema.nullable(),
  source: z.string(),
})
const userOutputSchema = z.object({
  id: decimalIdSchema,
  username: z.string(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  role: z.string(),
  status: z.number().int(),
  pointsBalance: z.number().int(),
  walletAddress: z.string().nullable(),
  createdAt: isoDateSchema,
  currentMembership: membershipSummarySchema.nullable(),
})
const membershipLevelSchema = z.object({
  id: decimalIdSchema,
  name: z.string(),
  rank: z.number().int(),
  pricePoints: z.number().int(),
  validityDays: z.number().int().nullable(),
  status: z.number().int(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
})
const membershipGrantSchema = z.object({
  id: decimalIdSchema,
  membershipLevel: membershipLevelSchema,
  source: z.string(),
  pointsCost: z.number().int().nullable(),
  grantedByUserId: decimalIdSchema.nullable(),
  grantedAt: isoDateSchema,
  expiresAt: isoDateSchema.nullable(),
  revokedAt: isoDateSchema.nullable(),
  revokedByUserId: decimalIdSchema.nullable(),
  active: z.boolean(),
})
const userMembershipSchema = z.object({
  currentMembership: membershipSummarySchema.nullable(),
  grants: z.array(membershipGrantSchema),
})
const pointTransactionSchema = z.object({
  id: decimalIdSchema,
  amount: z.number().int(),
  balanceAfter: z.number().int(),
  type: z.string(),
  description: z.string().nullable(),
  createdAt: isoDateSchema,
})
const pointTransactionListSchema = z.object({
  pointsBalance: z.number().int(),
  list: z.array(pointTransactionSchema),
  ...paginationOutputShape,
})
const giftCardBatchSchema = z.object({
  id: decimalIdSchema,
  name: z.string(),
  points: z.number().int(),
  quantity: z.number().int(),
  redeemed: z.number().int(),
  status: z.number().int(),
  expiresAt: isoDateSchema.nullable(),
  createdBy: z.string(),
  createdAt: isoDateSchema,
})
const contractSchema = z.object({
  id: decimalIdSchema,
  contractId: z.string(),
  title: z.string(),
  body: z.string(),
  bodyHash: z.string(),
  contractHash: z.string().nullable(),
  attachment: z.object({ id: decimalIdSchema, originalName: z.string(), fileSize: z.string() }).nullable(),
  status: z.number().int(),
  issuedAt: isoDateSchema.nullable(),
  signedAt: isoDateSchema.nullable(),
  declinedAt: isoDateSchema.nullable(),
  declineReason: z.string().nullable(),
  cancelledAt: isoDateSchema.nullable(),
  issuer: z.object({ id: decimalIdSchema, username: z.string(), displayName: z.string().nullable() }),
  subject: z.object({ id: decimalIdSchema, username: z.string(), displayName: z.string().nullable() }),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  credentials: z.array(jsonObjectSchema),
  signedAudit: jsonObjectSchema.nullable().optional(),
  adminAudit: z.array(jsonObjectSchema).optional(),
})
const evidenceSchema = z.object({
  id: decimalIdSchema,
  subjectType: z.string(),
  subjectId: z.string(),
  subjectHash: z.string(),
  projectVersionId: decimalIdSchema,
  projectId: decimalIdSchema,
  projectName: z.string(),
  version: z.string(),
  versionVisible: z.boolean(),
  subjectVisible: z.boolean(),
  network: z.string(),
  signerAddress: z.string(),
  transactionSignature: z.string().nullable(),
  status: z.number().int(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  attempts: z.array(jsonObjectSchema),
})
const dashboardSchema = z.object({
  range: z.object({ days: z.number().int(), start: z.string(), end: z.string(), generatedAt: isoDateSchema }),
  overview: jsonObjectSchema,
  periodTotals: z.object({ users: z.number().int(), projects: z.number().int(), articles: z.number().int(), notes: z.number().int() }),
  trend: z.array(jsonObjectSchema),
  health: jsonObjectSchema,
  recentActivity: jsonObjectSchema,
})
const settingsSchema = z.object({ configs: z.array(jsonObjectSchema), groups: z.array(jsonObjectSchema) })
const systemUpdateSchema = z.object({
  checkedAt: isoDateSchema,
  status: z.enum(['UP_TO_DATE', 'UPDATE_AVAILABLE', 'LOCAL_NEWER', 'UNVERSIONED', 'HISTORY_INCOMPLETE', 'CHECK_FAILED']),
  repository: z.string(),
  installed: jsonObjectSchema,
  nextRelease: jsonObjectSchema.nullable(),
  historyComplete: z.boolean(),
  error: z.string().nullable(),
})
const evidenceStatusSchema = z.number().int().min(-32_768).max(32_767).optional()

export const adminReadToolDefinitions: McpToolDefinition[] = collectMcpToolDefinitions((server) => {
  server.defineTool(
    'admin.dashboard.get',
    {
      title: '读取管理员仪表盘',
      description: '读取管理员运营概览、趋势、健康度和脱敏的近期活动。该工具只读。',
      inputSchema: z.strictObject({ range: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30) }),
      outputSchema: dashboardSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ range }) => runMcpTool('admin.dashboard.get', async () => getAdminDashboard({ range })),
  )

  server.defineTool(
    'admin.user.list',
    {
      title: '列出用户',
      description: '分页读取用户资料摘要和当前会员状态，不返回密码或 Session。该工具只读。',
      inputSchema: z.strictObject({
        page: pageSchema,
        pageSize: pageSizeSchema,
        keyword: z.string().trim().max(120).default(''),
      }),
      outputSchema: paginatedListSchema(userOutputSchema),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ page, pageSize, keyword }) => runMcpTool('admin.user.list', async () => {
      const result = await listUsers({ page, pageSize, keyword: keyword.trim() })
      return { list: result.list, page, pageSize, total: result.total }
    }),
  )

  server.defineTool(
    'admin.user.get',
    {
      title: '读取用户',
      description: '按用户 ID 读取用户资料摘要和当前会员状态，不返回密码或 Session。该工具只读。',
      inputSchema: z.strictObject({ userId: decimalIdSchema }),
      outputSchema: userOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ userId }) => runMcpTool('admin.user.get', async () => getManagedUser(mcpId(userId, 'userId'))),
  )

  server.defineTool(
    'admin.membership.level.list',
    {
      title: '列出会员等级',
      description: '读取会员等级及积分价格，不修改会员配置。该工具只读。',
      inputSchema: z.strictObject({ includeDisabled: z.boolean().default(true) }),
      outputSchema: z.object({ list: z.array(membershipLevelSchema) }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ includeDisabled }) => runMcpTool('admin.membership.level.list', async () => ({
      list: await listMembershipLevels({ includeDisabled }),
    })),
  )

  server.defineTool(
    'admin.user.membership.get',
    {
      title: '读取用户会员',
      description: '读取用户当前会员和历史授予记录，不授予或撤销会员。该工具只读。',
      inputSchema: z.strictObject({ userId: decimalIdSchema }),
      outputSchema: userMembershipSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ userId }) => runMcpTool('admin.user.membership.get', async () =>
      getManagedUserMembership(mcpId(userId, 'userId'))),
  )

  server.defineTool(
    'admin.points.transaction.list',
    {
      title: '列出用户积分流水',
      description: '读取一个用户的积分余额和流水，不调整积分。该工具只读。',
      inputSchema: z.strictObject({
        userId: decimalIdSchema,
        page: pageSchema,
        pageSize: pageSizeSchema,
      }),
      outputSchema: pointTransactionListSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ userId, page, pageSize }) => runMcpTool('admin.points.transaction.list', async () => ({
      ...(await listUserPointTransactions(mcpId(userId, 'userId'), page, pageSize)),
      page,
      pageSize,
    })),
  )

  server.defineTool(
    'admin.gift_card.batch.list',
    {
      title: '列出卡密批次',
      description: '读取卡密批次统计，不返回明文卡密且不发行卡密。该工具只读。',
      inputSchema: z.strictObject({ page: pageSchema, pageSize: pageSizeSchema }),
      outputSchema: paginatedListSchema(giftCardBatchSchema),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ page, pageSize }) => runMcpTool('admin.gift_card.batch.list', async () => ({
      ...(await listGiftCardBatches(page, pageSize)),
      page,
      pageSize,
    })),
  )

  server.defineTool(
    'admin.contract.list',
    {
      title: '列出合同',
      description: '分页读取管理员合同及其审计摘要，不创建、签发或取消合同。该工具只读。',
      inputSchema: z.strictObject({
        page: pageSchema,
        pageSize: pageSizeSchema,
        keyword: z.string().trim().max(120).default(''),
        status: z.number().int().min(-32_768).max(32_767).optional(),
      }),
      outputSchema: paginatedListSchema(contractSchema),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ page, pageSize, keyword, status }) => runMcpTool('admin.contract.list', async () =>
      listAdminContracts({ page, pageSize, keyword: keyword.trim(), status })),
  )

  server.defineTool(
    'admin.contract.get',
    {
      title: '读取合同',
      description: '按合同 ID 读取冻结字段和管理员审计摘要，不改变合同状态。该工具只读。',
      inputSchema: z.strictObject({ contractId: decimalIdSchema }),
      outputSchema: contractSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ contractId }) => runMcpTool('admin.contract.get', async () =>
      getAdminContract(mcpId(contractId, 'contractId'))),
  )

  server.defineTool(
    'admin.contract.attachment.get',
    {
      title: '读取合同附件资源',
      description: '返回合同附件的受保护 Resource URI，不把 PDF 内容嵌入普通 JSON。该工具只读。',
      inputSchema: z.strictObject({ contractId: decimalIdSchema }),
      outputSchema: z.object({ resourceUri: z.string(), contractId: decimalIdSchema }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ contractId }) => runMcpTool('admin.contract.attachment.get', async () => {
      const parsedContractId = mcpId(contractId, 'contractId')
      const contract = await getAdminContract(parsedContractId)
      if (!contract.attachment) throw new HttpError('Contract attachment not found', 404, 404)
      return {
        contractId,
        resourceUri: `slothvault://contract-attachment/${parsedContractId}`,
      }
    }),
  )

  server.defineTool(
    'admin.evidence.list',
    {
      title: '列出链上存证',
      description: '读取数据库中的存证索引、网络和状态摘要，不访问链上 RPC。该工具只读。',
      inputSchema: z.strictObject({
        page: pageSchema,
        pageSize: pageSizeSchema,
        projectId: decimalIdSchema.optional(),
        projectVersionId: decimalIdSchema.optional(),
        network: z.enum(['mainnet', 'devnet']).optional(),
        status: evidenceStatusSchema,
        transactionSignature: z.string().trim().max(200).optional(),
      }),
      outputSchema: z.object({
        list: z.array(evidenceSchema),
        ...paginationOutputShape,
        summary: z.array(jsonObjectSchema),
        defaultNetwork: z.string(),
        networks: z.array(jsonObjectSchema),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ page, pageSize, projectId, projectVersionId, network, status, transactionSignature }) =>
      runMcpTool('admin.evidence.list', async () => listReleaseEvidence({
        page,
        pageSize,
        projectId: projectId === undefined ? undefined : mcpId(projectId, 'projectId'),
        projectVersionId: projectVersionId === undefined ? undefined : mcpId(projectVersionId, 'projectVersionId'),
        network,
        status,
        transactionSignature,
      })),
  )

  server.defineTool(
    'admin.evidence.get',
    {
      title: '读取链上存证',
      description: '按存证记录 ID 读取数据库索引和状态，不执行链上核验。该工具只读。',
      inputSchema: z.strictObject({ evidenceId: decimalIdSchema }),
      outputSchema: evidenceSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ evidenceId }) => runMcpTool('admin.evidence.get', async () =>
      getAdminReleaseEvidence(mcpId(evidenceId, 'evidenceId'))),
  )

  server.defineTool(
    'admin.settings.get',
    {
      title: '读取系统设置',
      description: '读取已脱敏的系统配置和品牌状态，不返回敏感 RPC 地址。该工具只读。',
      inputSchema: z.strictObject({}),
      outputSchema: settingsSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => runMcpTool('admin.settings.get', listAdminSettings),
  )

  server.defineTool(
    'admin.system.update.get',
    {
      title: '读取系统更新信息',
      description: '读取已安装版本和可用发布信息，不执行更新。该工具只读。',
      inputSchema: z.strictObject({}),
      outputSchema: systemUpdateSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => runMcpTool('admin.system.update.get', getSystemUpdateInfo),
  )
})
