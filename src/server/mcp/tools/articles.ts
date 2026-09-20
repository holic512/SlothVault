/**
 * @file articles.ts
 * @project SlothVault
 * @module MCP Article Tools
 * @description Registers MCP 3.0 article reads and draft-safe content mutations without lifecycle operations.
 * @logic Expose list, detail, create, and update through the article service while excluding publish, withdraw, delete, and restore inputs.
 * @dependencies MCP TypeScript SDK, zod, document limits, admin article service, MCP tool contracts
 * @index_tags mcp,tools,article,content,draft
 * @author holic512
 */
import 'server-only'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { DOCUMENT_CONTENT_MAX_CHARACTERS } from '@/lib/document-content'
import {
  createAdminArticle,
  getAdminArticle,
  listAdminArticles,
  updateAdminArticle,
} from '@/server/services/admin-articles'

import {
  CREATE_ANNOTATIONS,
  decimalIdSchema,
  isoDateSchema,
  mcpId,
  pageSchema,
  pageSizeSchema,
  paginationOutputShape,
  READ_ONLY_ANNOTATIONS,
  runMcpTool,
  statusSchema,
  UPDATE_ANNOTATIONS,
} from './common'

const membershipSummarySchema = z.object({
  id: decimalIdSchema,
  name: z.string(),
  rank: z.number().int(),
}).nullable()

const articleOutputSchema = z.object({
  id: decimalIdSchema,
  title: z.string(),
  summary: z.string().nullable(),
  cover: z.string().nullable(),
  content: z.string(),
  status: z.number().int(),
  requiredMembershipLevelId: decimalIdSchema.nullable(),
  requiredMembershipLevel: membershipSummarySchema,
  publishedAt: isoDateSchema.nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  isDeleted: z.boolean(),
})

const articleValuesSchema = {
  title: z.string().trim().min(1).max(255),
  summary: z.string().trim().max(500).nullable().optional(),
  cover: z.string().max(500).nullable().optional(),
  content: z.string().max(DOCUMENT_CONTENT_MAX_CHARACTERS),
  requiredMembershipLevelId: decimalIdSchema.nullable().optional(),
}

const updateArticleSchema = z.strictObject({
  articleId: decimalIdSchema,
  title: articleValuesSchema.title.optional(),
  summary: articleValuesSchema.summary,
  cover: articleValuesSchema.cover,
  content: articleValuesSchema.content.optional(),
  requiredMembershipLevelId: articleValuesSchema.requiredMembershipLevelId,
}).refine(
  ({ title, summary, cover, content, requiredMembershipLevelId }) =>
    title !== undefined || summary !== undefined || cover !== undefined ||
    content !== undefined || requiredMembershipLevelId !== undefined,
  { message: '至少提供一个需要更新的文章字段。' },
)

export function registerArticleTools(server: McpServer) {
  server.registerTool(
    'content.article.list',
    {
      title: '列出文章',
      description: '分页读取未删除文章及会员访问要求。该工具只读。',
      inputSchema: z.strictObject({
        page: pageSchema,
        pageSize: pageSizeSchema,
        keyword: z.string().trim().max(120).default(''),
        status: statusSchema.optional(),
      }),
      outputSchema: z.object({
        list: z.array(articleOutputSchema),
        ...paginationOutputShape,
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ page, pageSize, keyword, status }) => runMcpTool('content.article.list', async () =>
      listAdminArticles({
        page,
        pageSize,
        skip: (page - 1) * pageSize,
        keyword: keyword.trim(),
        status,
        includeDeleted: false,
      })),
  )

  server.registerTool(
    'content.article.get',
    {
      title: '读取文章',
      description: '按 ID 读取完整文章正文和管理员元数据。该工具只读。',
      inputSchema: z.strictObject({ articleId: decimalIdSchema }),
      outputSchema: articleOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ articleId }) => runMcpTool('content.article.get', async () =>
      getAdminArticle(mcpId(articleId, 'articleId'))),
  )

  server.registerTool(
    'content.article.create',
    {
      title: '创建文章草稿',
      description: '创建未发布文章，不执行发布或可见性变更。',
      inputSchema: z.strictObject(articleValuesSchema),
      outputSchema: articleOutputSchema,
      annotations: CREATE_ANNOTATIONS,
    },
    async ({ title, summary, cover, content, requiredMembershipLevelId }) =>
      runMcpTool('content.article.create', async () => createAdminArticle({
        title,
        summary,
        cover,
        content,
        requiredMembershipLevelId: requiredMembershipLevelId === undefined || requiredMembershipLevelId === null
          ? requiredMembershipLevelId
          : mcpId(requiredMembershipLevelId, 'requiredMembershipLevelId'),
      })),
  )

  server.registerTool(
    'content.article.update',
    {
      title: '更新文章内容',
      description: '更新文章内容字段，不发布、撤回、删除或恢复文章。',
      inputSchema: updateArticleSchema,
      outputSchema: articleOutputSchema,
      annotations: UPDATE_ANNOTATIONS,
    },
    async ({ articleId, title, summary, cover, content, requiredMembershipLevelId }) =>
      runMcpTool('content.article.update', async () => updateAdminArticle(
        mcpId(articleId, 'articleId'),
        {
          title,
          summary,
          cover,
          content,
          requiredMembershipLevelId: requiredMembershipLevelId === undefined || requiredMembershipLevelId === null
            ? requiredMembershipLevelId
            : mcpId(requiredMembershipLevelId, 'requiredMembershipLevelId'),
        },
      )),
  )
}
