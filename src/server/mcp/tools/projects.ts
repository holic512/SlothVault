/**
 * @file projects.ts
 * @project SlothVault
 * @module MCP Project Tools
 * @description Registers administrator MCP project listing, detail, creation, and draft-safe metadata update tools.
 * @logic Delegate project operations to the catalog service, create enabled project shells, and prevent MCP name or avatar updates once any project release exists while still allowing weight changes.
 * @dependencies MCP TypeScript SDK, zod, services/admin-catalog, mcp tool contracts
 * @index_tags mcp,tools,project,list,get,create,metadata
 * @author holic512
 */
import 'server-only'

import { z } from 'zod'

import { collectMcpToolDefinitions, type McpToolDefinition } from '@/server/mcp/registry'

import {
  createAdminProject,
  getAdminProject,
  listAdminProjects,
  updateAdminProjectMetadataFromMcp,
} from '@/server/services/admin-catalog'

import {
  CREATE_ANNOTATIONS,
  databaseIntegerSchema,
  decimalIdSchema,
  isoDateSchema,
  mcpId,
  pageSchema,
  pageSizeSchema,
  paginationOutputShape,
  READ_ONLY_ANNOTATIONS,
  runMcpTool,
  UPDATE_ANNOTATIONS,
} from './common'

const projectOutputSchema = z.object({
  id: decimalIdSchema,
  projectName: z.string(),
  avatar: z.string().nullable(),
  weight: z.number().int(),
  status: z.number().int(),
  requireAuth: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  isDeleted: z.boolean(),
})

const projectListItemOutputSchema = projectOutputSchema.extend({
  latestVersion: z.string().nullable(),
  latestVersionId: decimalIdSchema.nullable(),
  categoryCount: z.number().int(),
})

const updateProjectMetadataSchema = z.strictObject({
  projectId: decimalIdSchema.describe('项目 ID，使用正十进制字符串。'),
  projectName: z.string().trim().min(1).max(128).optional(),
  avatar: z.string().max(500).nullable().optional(),
  weight: databaseIntegerSchema.optional(),
}).refine(
  ({ projectName, avatar, weight }) =>
    projectName !== undefined || avatar !== undefined || weight !== undefined,
  { message: '至少提供 projectName、avatar 或 weight 之一。' },
)

export const projectToolDefinitions: McpToolDefinition[] = collectMcpToolDefinitions((server) => {
  server.defineTool(
    'content.project.list',
    {
      title: '列出管理员项目',
      description: '分页读取未删除项目及其最新已发布版本摘要。该工具只读。',
      inputSchema: z.strictObject({
        page: pageSchema,
        pageSize: pageSizeSchema,
        keyword: z.string().trim().max(120).default(''),
      }),
      outputSchema: z.object({
        list: z.array(projectListItemOutputSchema),
        ...paginationOutputShape,
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ page, pageSize, keyword }) => runMcpTool('content.project.list', async () =>
      listAdminProjects({
        page,
        pageSize,
        skip: (page - 1) * pageSize,
        keyword: keyword.trim(),
        status: undefined,
        orderByField: 'updatedAt',
        order: 'desc',
      })),
  )

  server.defineTool(
    'content.project.get',
    {
      title: '读取项目详情',
      description: '按 ID 读取一个管理员项目，包括状态和删除标记。该工具只读。',
      inputSchema: z.strictObject({
        projectId: decimalIdSchema.describe('项目 ID，使用正十进制字符串。'),
      }),
      outputSchema: projectOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ projectId }) => runMcpTool('content.project.get', async () =>
      getAdminProject(mcpId(projectId, 'projectId'))),
  )

  server.defineTool(
    'content.project.create',
    {
      title: '创建项目草稿外壳',
      description: '创建启用的项目外壳。项目在存在已发布版本前不会出现在公开项目列表。',
      inputSchema: z.strictObject({
        projectName: z.string().trim().min(1).max(128),
        avatar: z.string().max(500).nullable().optional(),
        weight: databaseIntegerSchema.default(0),
      }),
      outputSchema: projectOutputSchema,
      annotations: CREATE_ANNOTATIONS,
    },
    async ({ projectName, avatar, weight }) => runMcpTool('content.project.create', async () =>
      createAdminProject({ projectName, avatar, weight, status: 1 })),
  )

  server.defineTool(
    'content.project.update',
    {
      title: '更新项目元数据',
      description: '更新项目名称、头像或权重。已有发布版本时仅允许修改权重。',
      inputSchema: updateProjectMetadataSchema,
      outputSchema: projectOutputSchema,
      annotations: UPDATE_ANNOTATIONS,
    },
    async ({ projectId, projectName, avatar, weight }) =>
      runMcpTool('content.project.update', async () => updateAdminProjectMetadataFromMcp(
        mcpId(projectId, 'projectId'),
        { projectName, avatar, weight },
      )),
  )
})
