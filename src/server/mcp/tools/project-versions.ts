/**
 * @file project-versions.ts
 * @project SlothVault
 * @module MCP Project Version Tools
 * @description Registers administrator MCP project-version reads, empty or cloned draft creation, metadata edits, publication, and visibility.
 * @logic Keep version creation draft-only, validate published clone sources within the requested project, and reuse canonical release transactions and content-only integrity.
 * @dependencies MCP TypeScript SDK, zod, admin catalog service, project-version release service, mcp tool contracts
 * @index_tags mcp,tools,project-version,draft,clone,preflight
 * @author holic512
 */
import 'server-only'

import { Buffer } from 'node:buffer'

import { z } from 'zod'
import { collectMcpToolDefinitions, type McpToolDefinition } from '@/server/mcp/registry'

import { HttpError } from '@/server/http/errors'
import {
  createAdminProjectVersion,
  getAdminProjectVersion,
  listAdminProjectVersions,
  updateAdminProjectVersion,
} from '@/server/services/admin-catalog'
import {
  checkDraftProjectVersion,
  cloneProjectVersion,
  publishProjectVersion,
  setProjectVersionVisibility,
  getProjectVersionIntegrity,
  getProjectVersionManifest,
} from '@/server/services/project-version-release'

import {
  CREATE_ANNOTATIONS,
  UPDATE_ANNOTATIONS,
  statusSchema,
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
  isEmpty: z.boolean().optional(),
  project: projectSummaryOutputSchema.optional(),
})

const releaseIssueOutputSchema = z.object({
  code: z.string(),
  entity: z.enum(['projectVersion', 'project', 'category', 'note', 'content', 'release']),
  entityId: z.string(),
  message: z.string(),
})

const orderBySchema = z.enum([
  'publishedAt',
  'id',
  'version',
  'weight',
  'status',
  'createdAt',
  'updatedAt',
]).default('publishedAt')

export const projectVersionToolDefinitions: McpToolDefinition[] = collectMcpToolDefinitions((server) => {
  server.defineTool(
    'content.project.version.list',
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
      runMcpTool('content.project.version.list', async () => listAdminProjectVersions({
        page,
        pageSize,
        skip: (page - 1) * pageSize,
        keyword: keyword.trim(),
        includeProject: true,
        status: undefined,
        projectId: projectId === undefined ? undefined : mcpId(projectId, 'projectId'),
        orderByField: orderBy,
        order,
      })),
  )

  server.defineTool(
    'content.project.version.get',
    {
      title: '读取项目版本',
      description: '按 ID 读取项目版本及其所属项目，包括草稿和发布元数据。该工具只读。',
      inputSchema: z.strictObject({
        projectVersionId: decimalIdSchema,
      }),
      outputSchema: projectVersionOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ projectVersionId }) => runMcpTool('content.project.version.get', async () =>
      getAdminProjectVersion(mcpId(projectVersionId, 'projectVersionId'))),
  )

  server.defineTool(
    'content.project.version.create_draft',
    {
      title: '创建项目版本草稿',
      description: '创建一个空的未发布版本草稿，不会发布或复制其他版本。',
      inputSchema: z.strictObject({
        projectId: decimalIdSchema,
        version: z.string().trim().min(1).max(64),
        description: z.string().nullable().optional(),
        weight: databaseIntegerSchema.optional(),
      }),
      outputSchema: projectVersionOutputSchema,
      annotations: CREATE_ANNOTATIONS,
    },
    async ({ projectId, version, description, weight }) =>
      runMcpTool('content.project.version.create_draft', async () => createAdminProjectVersion({
        projectId,
        version,
        description: description ?? null,
        weight: weight ?? 0,
      })),
  )

  server.defineTool(
    'content.project.version.clone',
    {
      title: '从发布版本创建草稿',
      description: '从同一项目的未删除发布版本复制完整文档树，创建新草稿或填入同项目的完全空草稿。',
      inputSchema: z.strictObject({
        projectId: decimalIdSchema,
        sourceVersionId: decimalIdSchema,
        version: z.string().trim().min(1).max(64).optional(),
        targetVersionId: decimalIdSchema.optional(),
        description: z.string().nullable().optional(),
        weight: databaseIntegerSchema.optional(),
      }).refine((value) => value.targetVersionId !== undefined
        ? value.version === undefined && value.description === undefined && value.weight === undefined
        : value.version !== undefined, { message: '提供新版本号，或仅提供目标草稿 ID。' }),
      outputSchema: projectVersionOutputSchema,
      annotations: CREATE_ANNOTATIONS,
    },
    async ({ projectId, sourceVersionId, version, description, weight, targetVersionId }) =>
      runMcpTool('content.project.version.clone', async () => {
        const parsedProjectId = mcpId(projectId, 'projectId')
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
          ...(targetVersionId !== undefined ? { targetVersionId: mcpId(targetVersionId, 'targetVersionId') } : { version }),
          ...(description !== undefined ? { description } : {}),
          ...(weight !== undefined ? { weight } : {}),
        })
      }),
  )

  server.defineTool(
    'content.project.version.check_draft',
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
    async ({ projectVersionId }) => runMcpTool('content.project.version.check_draft', async () =>
      checkDraftProjectVersion(mcpId(projectVersionId, 'projectVersionId'))),
  )

  server.defineTool(
    'content.project.version.integrity',
    {
      title: '检查发布版本完整性',
      description: '只读重建发布版本清单并比较已存储哈希，不返回内部字节缓冲区。',
      inputSchema: z.strictObject({ projectVersionId: decimalIdSchema }),
      outputSchema: z.object({
        releaseId: z.string().nullable(),
        storedHash: z.string().nullable(),
        computedHash: z.string().nullable(),
        valid: z.boolean(),
        manifestVersion: z.number().int().nullable(),
        publishedAt: isoDateSchema.nullable(),
        issues: z.array(releaseIssueOutputSchema),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ projectVersionId }) => runMcpTool('content.project.version.integrity', async () => {
      const integrity = await getProjectVersionIntegrity(mcpId(projectVersionId, 'projectVersionId'))
      return {
        releaseId: integrity.releaseId,
        storedHash: integrity.storedHash,
        computedHash: integrity.computedHash,
        valid: integrity.valid,
        manifestVersion: integrity.manifestVersion,
        publishedAt: integrity.publishedAt,
        issues: integrity.issues,
      }
    }),
  )

  server.defineTool(
    'content.project.version.manifest',
    {
      title: '读取发布版本清单',
      description: '只读校验并返回一个发布版本的规范 JSON 清单。',
      inputSchema: z.strictObject({ projectVersionId: decimalIdSchema }),
      outputSchema: z.object({
        releaseId: z.string(),
        releaseHash: z.string(),
        manifest: z.object({}).passthrough(),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ projectVersionId }) => runMcpTool('content.project.version.manifest', async () => {
      const result = await getProjectVersionManifest(mcpId(projectVersionId, 'projectVersionId'))
      return {
        releaseId: result.releaseId,
        releaseHash: result.releaseHash,
        manifest: JSON.parse(Buffer.from(result.bytes).toString('utf8')) as Record<string, unknown>,
      }
    }),
  )
  server.defineTool(
    'content.project.version.update',
    {
      title: '更新版本名称与说明',
      description: '修改草稿或发布版本的名称、说明和展示权重，不修改正文或发布状态。',
      inputSchema: z.strictObject({
        projectVersionId: decimalIdSchema,
        version: z.string().trim().min(1).max(64).optional(),
        description: z.string().nullable().optional(),
        weight: databaseIntegerSchema.optional(),
      }).refine(({ version, description, weight }) => version !== undefined || description !== undefined || weight !== undefined),
      outputSchema: projectVersionOutputSchema,
      annotations: UPDATE_ANNOTATIONS,
    },
    async ({ projectVersionId, ...input }) => runMcpTool('content.project.version.update', async () =>
      updateAdminProjectVersion(mcpId(projectVersionId, 'projectVersionId'), input)),
  )

  server.defineTool(
    'content.project.version.publish',
    {
      title: '发布项目版本',
      description: '在事务中校验并发布草稿；重复调用返回同一发布记录。',
      inputSchema: z.strictObject({ projectVersionId: decimalIdSchema }),
      outputSchema: projectVersionOutputSchema,
      annotations: UPDATE_ANNOTATIONS,
    },
    async ({ projectVersionId }) => runMcpTool('content.project.version.publish', async () => {
      const id = mcpId(projectVersionId, 'projectVersionId')
      await publishProjectVersion(id)
      return getAdminProjectVersion(id)
    }),
  )

  server.defineTool(
    'content.project.version.set_visibility',
    {
      title: '显示或隐藏发布版本',
      description: '调整已发布版本的可见状态，不改变正文和发布标识。',
      inputSchema: z.strictObject({ projectVersionId: decimalIdSchema, status: statusSchema }),
      outputSchema: projectVersionOutputSchema,
      annotations: UPDATE_ANNOTATIONS,
    },
    async ({ projectVersionId, status }) => runMcpTool('content.project.version.set_visibility', async () => {
      const id = mcpId(projectVersionId, 'projectVersionId')
      await setProjectVersionVisibility(id, status)
      return getAdminProjectVersion(id)
    }),
  )

})
