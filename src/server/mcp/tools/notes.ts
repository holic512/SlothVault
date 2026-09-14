/**
 * @file notes.ts
 * @project SlothVault
 * @module MCP Note Tools
 * @description Registers administrator MCP note metadata listing, detail, creation, and draft-only update tools.
 * @logic Bind new note authorship to the authenticated MCP administrator and delegate all hierarchy mutations to the notes service's draft locks.
 * @dependencies MCP TypeScript SDK, zod, services/admin-notes, services/mcp-api-keys, mcp tool contracts
 * @index_tags mcp,tools,note,metadata,author,draft
 * @author holic512
 */
import 'server-only'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import {
  createAdminNote,
  getAdminNote,
  listAdminNotes,
  updateAdminNote,
} from '@/server/services/admin-notes'
import type { McpPrincipal } from '@/server/services/mcp-api-keys'

import {
  CREATE_ANNOTATIONS,
  databaseIntegerSchema,
  decimalIdSchema,
  isoDateSchema,
  mcpId,
  orderSchema,
  pageSchema,
  pageSizeSchema,
  paginationOutputShape,
  READ_ONLY_ANNOTATIONS,
  runMcpTool,
  statusSchema,
  UPDATE_ANNOTATIONS,
} from './common'

const projectSummaryOutputSchema = z.object({
  id: decimalIdSchema,
  projectName: z.string(),
}).nullable()

const projectVersionSummaryOutputSchema = z.object({
  id: decimalIdSchema,
  version: z.string(),
  projectId: decimalIdSchema,
  publishedAt: isoDateSchema.nullable(),
  project: projectSummaryOutputSchema.optional(),
}).nullable()

const categorySummaryOutputSchema = z.object({
  id: decimalIdSchema,
  categoryName: z.string(),
  projectVersionId: decimalIdSchema,
  projectVersion: projectVersionSummaryOutputSchema.optional(),
}).nullable()

const noteOutputSchema = z.object({
  id: decimalIdSchema,
  categoryId: decimalIdSchema,
  authorId: decimalIdSchema.nullable(),
  noteTitle: z.string(),
  weight: z.number().int(),
  status: z.number().int(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  isDeleted: z.boolean(),
  category: categorySummaryOutputSchema,
  contentCount: z.number().int().optional(),
})

const orderBySchema = z.enum([
  'id',
  'noteTitle',
  'weight',
  'status',
  'createdAt',
  'updatedAt',
]).default('updatedAt')

const updateNoteSchema = z.strictObject({
  noteId: decimalIdSchema,
  categoryId: decimalIdSchema.optional(),
  noteTitle: z.string().trim().min(1).max(255).optional(),
  weight: databaseIntegerSchema.optional(),
  status: statusSchema.optional(),
}).refine(
  ({ categoryId, noteTitle, weight, status }) =>
    categoryId !== undefined || noteTitle !== undefined || weight !== undefined || status !== undefined,
  { message: '至少提供一个需要更新的笔记字段。' },
)

export function registerNoteTools(server: McpServer, principal: McpPrincipal) {
  server.registerTool(
    'note.list',
    {
      title: '列出笔记',
      description: '分页读取未删除笔记、父级摘要和正文版本数量。该工具只读。',
      inputSchema: z.strictObject({
        page: pageSchema,
        pageSize: pageSizeSchema,
        projectId: decimalIdSchema.optional(),
        projectVersionId: decimalIdSchema.optional(),
        categoryId: decimalIdSchema.optional(),
        keyword: z.string().trim().max(120).default(''),
        status: statusSchema.optional(),
        orderBy: orderBySchema,
        order: orderSchema,
      }),
      outputSchema: z.object({
        list: z.array(noteOutputSchema),
        ...paginationOutputShape,
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({
      page,
      pageSize,
      projectId,
      projectVersionId,
      categoryId,
      keyword,
      status,
      orderBy,
      order,
    }) => runMcpTool('note.list', async () => listAdminNotes({
      page,
      pageSize,
      skip: (page - 1) * pageSize,
      keyword: keyword.trim(),
      includeDeleted: false,
      onlyDeleted: false,
      status,
      categoryId: categoryId === undefined ? undefined : mcpId(categoryId, 'categoryId'),
      projectVersionId: projectVersionId === undefined
        ? undefined
        : mcpId(projectVersionId, 'projectVersionId'),
      projectId: projectId === undefined ? undefined : mcpId(projectId, 'projectId'),
      publishedOnly: false,
      orderByField: orderBy,
      order,
    })),
  )

  server.registerTool(
    'note.get',
    {
      title: '读取笔记',
      description: '按 ID 读取笔记元数据和完整父级摘要。该工具只读，不返回正文。',
      inputSchema: z.strictObject({ noteId: decimalIdSchema }),
      outputSchema: noteOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ noteId }) => runMcpTool('note.get', async () =>
      getAdminNote(mcpId(noteId, 'noteId'))),
  )

  server.registerTool(
    'note.create',
    {
      title: '创建笔记',
      description: '在草稿版本的分类中创建笔记，作者固定为当前 MCP 管理员。',
      inputSchema: z.strictObject({
        categoryId: decimalIdSchema,
        noteTitle: z.string().trim().min(1).max(255),
        weight: databaseIntegerSchema.default(0),
        status: statusSchema.default(1),
      }),
      outputSchema: noteOutputSchema,
      annotations: CREATE_ANNOTATIONS,
    },
    async ({ categoryId, noteTitle, weight, status }) =>
      runMcpTool('note.create', async () => createAdminNote({
        categoryId,
        authorId: principal.userId,
        noteTitle,
        weight,
        status,
      })),
  )

  server.registerTool(
    'note.update',
    {
      title: '更新笔记草稿',
      description: '修改笔记元数据或移动到另一个分类；所有相关项目版本都必须未发布。',
      inputSchema: updateNoteSchema,
      outputSchema: noteOutputSchema,
      annotations: UPDATE_ANNOTATIONS,
    },
    async ({ noteId, categoryId, noteTitle, weight, status }) =>
      runMcpTool('note.update', async () => updateAdminNote(
        mcpId(noteId, 'noteId'),
        { categoryId, noteTitle, weight, status },
      )),
  )
}
