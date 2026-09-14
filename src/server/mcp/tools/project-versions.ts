/**
 * @file project-versions.ts
 * @project SlothVault
 * @module MCP Project Version Tools
 * @description Registers administrator MCP project-version reads, empty or cloned draft creation, and read-only publication preflight checks.
 * @logic Keep version creation draft-only, validate published clone sources within the requested project, and reuse canonical release validation without writing release state.
 * @dependencies MCP TypeScript SDK, zod, admin catalog service, project-version release service, mcp tool contracts
 * @index_tags mcp,tools,project-version,draft,clone,preflight
 * @author holic512
 */
import 'server-only'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { HttpError } from '@/server/http/errors'
import {
  createAdminProjectVersion,
  getAdminProjectVersion,
  listAdminProjectVersions,
} from '@/server/services/admin-catalog'
import {
  checkDraftProjectVersion,
  cloneProjectVersion,
} from '@/server/services/project-version-release'

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
} from './common'

const projectSummaryOutputSchema = z.object({
  id: decimalIdSchema,
  projectName: z.string(),
}).nullable()

const projectVersionOutputSchema = z.object({
  id: decimalIdSchema,
  projectId: decimalIdSchema,
  version: z.string(),
  description: z.string().nullable(),
  weight: z.number().int(),
  status: z.number().int(),
  releaseId: z.string().nullable(),
  releaseHash: z.string().nullable(),
  manifestVersion: z.number().int().nullable(),
  publishedAt: isoDateSchema.nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  isDeleted: z.boolean(),
  project: projectSummaryOutputSchema.optional(),
})

const releaseIssueOutputSchema = z.object({
  code: z.string(),
  entity: z.enum(['projectVersion', 'project', 'category', 'note', 'content', 'release']),
  entityId: z.string(),
  message: z.string(),
})

const orderBySchema = z.enum([
  'id',
  'version',
  'weight',
  'status',
  'createdAt',
  'updatedAt',
]).default('updatedAt')

export function registerProjectVersionTools(server: McpServer) {
  server.registerTool(
    'project_version.list',
    {
      title: '列出项目版本',
      description: '分页读取未删除的项目版本，包括草稿和不可变发布版本。该工具只读。',
      inputSchema: z.strictObject({
        page: pageSchema,
        pageSize: pageSizeSchema,
        projectId: decimalIdSchema.optional(),
        keyword: z.string().trim().max(120).default(''),
        orderBy: orderBySchema,
        order: orderSchema,
      }),
      outputSchema: z.object({
        list: z.array(projectVersionOutputSchema),
        ...paginationOutputShape,
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ page, pageSize, projectId, keyword, orderBy, order }) =>
      runMcpTool('project_version.list', async () => listAdminProjectVersions({
        page,
        pageSize,
        skip: (page - 1) * pageSize,
        keyword: keyword.trim(),
        includeDeleted: false,
        onlyDeleted: false,
        includeProject: true,
        status: undefined,
        projectId: projectId === undefined ? undefined : mcpId(projectId, 'projectId'),
        orderByField: orderBy,
        order,
      })),
  )

  server.registerTool(
    'project_version.get',
    {
      title: '读取项目版本',
      description: '按 ID 读取项目版本及其所属项目，包括草稿和发布元数据。该工具只读。',
      inputSchema: z.strictObject({
        projectVersionId: decimalIdSchema,
      }),
      outputSchema: projectVersionOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ projectVersionId }) => runMcpTool('project_version.get', async () =>
      getAdminProjectVersion(mcpId(projectVersionId, 'projectVersionId'))),
  )

  server.registerTool(
    'project_version.create_draft',
    {
      title: '创建项目版本草稿',
      description: '创建空版本草稿，或从同一项目的已发布版本复制完整未删除文档树。不会发布。',
      inputSchema: z.strictObject({
        projectId: decimalIdSchema,
        version: z.string().trim().min(1).max(64),
        description: z.string().nullable().optional(),
        weight: databaseIntegerSchema.optional(),
        sourceVersionId: decimalIdSchema.optional(),
      }),
      outputSchema: projectVersionOutputSchema,
      annotations: CREATE_ANNOTATIONS,
    },
    async ({ projectId, version, description, weight, sourceVersionId }) =>
      runMcpTool('project_version.create_draft', async () => {
        const parsedProjectId = mcpId(projectId, 'projectId')
        if (sourceVersionId === undefined) {
          return createAdminProjectVersion({
            projectId,
            version,
            description: description ?? null,
            weight: weight ?? 0,
          })
        }

        const parsedSourceId = mcpId(sourceVersionId, 'sourceVersionId')
        const source = await getAdminProjectVersion(parsedSourceId)
        if (source.isDeleted || !source.publishedAt) {
          throw new HttpError('Clone source must be an undeleted published version', 409, 409, {
            reason: 'VERSION_NOT_PUBLISHED',
            projectVersionId: sourceVersionId,
          })
        }
        if (source.projectId !== String(parsedProjectId)) {
          throw new HttpError('Clone source must belong to the requested project', 409, 409, {
            reason: 'VERSION_PROJECT_MISMATCH',
            projectVersionId: sourceVersionId,
            projectId,
          })
        }
        return cloneProjectVersion(parsedSourceId, {
          version,
          ...(description !== undefined ? { description } : {}),
          ...(weight !== undefined ? { weight } : {}),
        })
      }),
  )

  server.registerTool(
    'project_version.check_draft',
    {
      title: '检查版本草稿发布就绪状态',
      description: '只读运行正式发布所用的文档树校验；不会创建发布记录、哈希或凭证。',
      inputSchema: z.strictObject({
        projectVersionId: decimalIdSchema,
      }),
      outputSchema: z.object({
        projectVersionId: decimalIdSchema,
        ready: z.boolean(),
        issues: z.array(releaseIssueOutputSchema),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ projectVersionId }) => runMcpTool('project_version.check_draft', async () =>
      checkDraftProjectVersion(mcpId(projectVersionId, 'projectVersionId'))),
  )
}
