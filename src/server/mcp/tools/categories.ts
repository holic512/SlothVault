/**
 * @file categories.ts
 * @project SlothVault
 * @module MCP Category Tools
 * @description Registers administrator MCP category listing, creation, and draft-only update tools.
 * @logic Map bounded inputs to the catalog service so category creation and cross-version moves inherit stable draft locking and published-version freezing.
 * @dependencies MCP TypeScript SDK, zod, services/admin-catalog, mcp tool contracts
 * @index_tags mcp,tools,category,list,create,update,draft
 * @author holic512
 */
import 'server-only'

import { z } from 'zod'

import { collectMcpToolDefinitions, type McpToolDefinition } from '@/server/mcp/registry'

import {
  createAdminCategory,
  listAdminCategories,
  updateAdminCategory,
} from '@/server/services/admin-catalog'

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

const projectVersionSummaryOutputSchema = z.object({
  id: decimalIdSchema,
  version: z.string(),
  projectId: decimalIdSchema,
  publishedAt: isoDateSchema.nullable(),
  project: z.object({
    id: decimalIdSchema,
    projectName: z.string(),
  }).nullable().optional(),
}).nullable()

const categoryOutputSchema = z.object({
  id: decimalIdSchema,
  projectVersionId: decimalIdSchema,
  categoryName: z.string(),
  weight: z.number().int(),
  status: z.number().int(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  isDeleted: z.boolean(),
  projectVersion: projectVersionSummaryOutputSchema.optional(),
})

const orderBySchema = z.enum([
  'id',
  'categoryName',
  'weight',
  'status',
  'createdAt',
  'updatedAt',
]).default('updatedAt')

const updateCategorySchema = z.strictObject({
  categoryId: decimalIdSchema,
  projectVersionId: decimalIdSchema.optional(),
  categoryName: z.string().trim().min(1).max(64).optional(),
  weight: databaseIntegerSchema.optional(),
  status: statusSchema.optional(),
}).refine(
  ({ projectVersionId, categoryName, weight, status }) =>
    projectVersionId !== undefined ||
    categoryName !== undefined ||
    weight !== undefined ||
    status !== undefined,
  { message: '至少提供一个需要更新的分类字段。' },
)

export const categoryToolDefinitions: McpToolDefinition[] = collectMcpToolDefinitions((server) => {
  server.defineTool(
    'content.category.list',
    {
      title: '列出分类',
      description: '分页读取未删除分类及所属项目版本摘要。该工具只读。',
      inputSchema: z.strictObject({
        page: pageSchema,
        pageSize: pageSizeSchema,
        projectId: decimalIdSchema.optional(),
        projectVersionId: decimalIdSchema.optional(),
        keyword: z.string().trim().max(120).default(''),
        status: statusSchema.optional(),
        orderBy: orderBySchema,
        order: orderSchema,
      }),
      outputSchema: z.object({
        list: z.array(categoryOutputSchema),
        ...paginationOutputShape,
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ page, pageSize, projectId, projectVersionId, keyword, status, orderBy, order }) =>
      runMcpTool('content.category.list', async () => listAdminCategories({
        page,
        pageSize,
        skip: (page - 1) * pageSize,
        keyword: keyword.trim(),
        includeProjectVersion: true,
        status,
        projectId: projectId === undefined ? undefined : mcpId(projectId, 'projectId'),
        projectVersionId: projectVersionId === undefined
          ? undefined
          : mcpId(projectVersionId, 'projectVersionId'),
        orderByField: orderBy,
        order,
      })),
  )

  server.defineTool(
    'content.category.create',
    {
      title: '创建分类',
      description: '在未发布的项目版本草稿中创建分类。',
      inputSchema: z.strictObject({
        projectVersionId: decimalIdSchema,
        categoryName: z.string().trim().min(1).max(64),
        weight: databaseIntegerSchema.default(0),
        status: statusSchema.default(1),
      }),
      outputSchema: categoryOutputSchema,
      annotations: CREATE_ANNOTATIONS,
    },
    async ({ projectVersionId, categoryName, weight, status }) =>
      runMcpTool('content.category.create', async () => createAdminCategory({
        projectVersionId,
        categoryName,
        weight,
        status,
      })),
  )

  server.defineTool(
    'content.category.update',
    {
      title: '更新分类草稿',
      description: '修改分类元数据或将分类移动到另一个草稿版本；所有相关版本都必须未发布。',
      inputSchema: updateCategorySchema,
      outputSchema: categoryOutputSchema,
      annotations: UPDATE_ANNOTATIONS,
    },
    async ({ categoryId, projectVersionId, categoryName, weight, status }) =>
      runMcpTool('content.category.update', async () => updateAdminCategory(
        mcpId(categoryId, 'categoryId'),
        { projectVersionId, categoryName, weight, status },
      )),
  )
})
