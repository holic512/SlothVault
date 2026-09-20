/**
 * @file pages.ts
 * @project SlothVault
 * @module MCP Page Structure Tools
 * @description Registers MCP 3.0 project homepage, project menu, and system homepage management tools.
 * @logic Expose ordinary reads, creates, and updates while omitting deletion and restoration fields from every MCP contract.
 * @dependencies MCP TypeScript SDK, zod, document limits, admin content service, MCP tool contracts
 * @index_tags mcp,tools,homepage,project-home,menu,content
 * @author holic512
 */
import 'server-only'

import { z } from 'zod'

import { collectMcpToolDefinitions, type McpToolDefinition } from '@/server/mcp/registry'

import { DOCUMENT_CONTENT_MAX_CHARACTERS } from '@/lib/document-content'
import {
  createProjectHome,
  createProjectMenu,
  createSystemHomepage,
  getProjectHome,
  getProjectMenu,
  getSystemHomepage,
  listProjectHomes,
  listProjectMenus,
  updateProjectHome,
  updateProjectMenu,
  updateSystemHomepage,
} from '@/server/services/admin-content'

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
  statusSchema,
  UPDATE_ANNOTATIONS,
} from './common'

const projectHomeOutputSchema = z.object({
  id: decimalIdSchema,
  projectId: decimalIdSchema,
  content: z.string(),
  status: z.number().int(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  isDeleted: z.boolean(),
})

const menuBaseOutputSchema = z.object({
  id: decimalIdSchema,
  projectId: decimalIdSchema,
  parentId: decimalIdSchema.nullable(),
  label: z.string(),
  url: z.string().nullable(),
  isExternal: z.boolean(),
  weight: z.number().int(),
  status: z.number().int(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  isDeleted: z.boolean(),
})

const menuOutputSchema = menuBaseOutputSchema.extend({
  children: z.array(menuBaseOutputSchema).optional(),
})

const homepageOutputSchema = z.object({
  id: decimalIdSchema,
  content: z.string(),
  status: z.number().int(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  isDeleted: z.boolean(),
})

const menuValuesSchema = {
  parentId: decimalIdSchema.nullable().optional(),
  label: z.string().trim().min(1).max(64),
  url: z.string().trim().max(2_048).nullable().optional(),
  isExternal: z.boolean().default(false),
  weight: databaseIntegerSchema.default(0),
  status: statusSchema.default(1),
}

export const pageToolDefinitions: McpToolDefinition[] = collectMcpToolDefinitions((server) => {
  server.defineTool(
    'content.project.home.list',
    {
      title: '列出项目主页',
      description: '分页读取未删除的项目主页。该工具只读。',
      inputSchema: z.strictObject({
        page: pageSchema,
        pageSize: pageSizeSchema,
        projectId: decimalIdSchema.optional(),
      }),
      outputSchema: z.object({ list: z.array(projectHomeOutputSchema), ...paginationOutputShape }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ page, pageSize, projectId }) => runMcpTool('content.project.home.list', async () =>
      listProjectHomes({
        page,
        pageSize,
        skip: (page - 1) * pageSize,
        projectId: projectId === undefined ? undefined : mcpId(projectId, 'projectId'),
      })),
  )

  server.defineTool(
    'content.project.home.get',
    {
      title: '读取项目主页',
      description: '按项目主页 ID 读取完整 Markdown。该工具只读。',
      inputSchema: z.strictObject({ projectHomeId: decimalIdSchema }),
      outputSchema: projectHomeOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ projectHomeId }) => runMcpTool('content.project.home.get', async () =>
      getProjectHome(mcpId(projectHomeId, 'projectHomeId'))),
  )

  server.defineTool(
    'content.project.home.create',
    {
      title: '创建项目主页',
      description: '为没有主页记录的项目创建公开主页；不会恢复已删除记录。',
      inputSchema: z.strictObject({
        projectId: decimalIdSchema,
        content: z.string().max(DOCUMENT_CONTENT_MAX_CHARACTERS),
        status: statusSchema.default(1),
      }),
      outputSchema: projectHomeOutputSchema,
      annotations: CREATE_ANNOTATIONS,
    },
    async ({ projectId, content, status }) => runMcpTool('content.project.home.create', async () =>
      createProjectHome(mcpId(projectId, 'projectId'), { content, status })),
  )

  server.defineTool(
    'content.project.home.update',
    {
      title: '更新项目主页',
      description: '更新项目主页正文或状态，修改可能立即影响公开站点。',
      inputSchema: z.strictObject({
        projectHomeId: decimalIdSchema,
        content: z.string().max(DOCUMENT_CONTENT_MAX_CHARACTERS).optional(),
        status: statusSchema.optional(),
      }).refine(
        ({ content, status }) => content !== undefined || status !== undefined,
        { message: '至少提供 content 或 status。' },
      ),
      outputSchema: projectHomeOutputSchema,
      annotations: UPDATE_ANNOTATIONS,
    },
    async ({ projectHomeId, content, status }) => runMcpTool('content.project.home.update', async () =>
      updateProjectHome(mcpId(projectHomeId, 'projectHomeId'), { content, status })),
  )

  server.defineTool(
    'content.project.menu.list',
    {
      title: '列出项目菜单',
      description: '读取一个项目的未删除菜单，可返回两级树。该工具只读。',
      inputSchema: z.strictObject({
        projectId: decimalIdSchema,
        tree: z.boolean().default(true),
      }),
      outputSchema: z.object({ list: z.array(menuOutputSchema) }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ projectId, tree }) => runMcpTool('content.project.menu.list', async () => ({
      list: await listProjectMenus({
        projectId: mcpId(projectId, 'projectId'),
        tree,
        includeDeleted: false,
      }),
    })),
  )

  server.defineTool(
    'content.project.menu.get',
    {
      title: '读取项目菜单',
      description: '按菜单 ID 读取菜单及其未删除子项。该工具只读。',
      inputSchema: z.strictObject({ menuId: decimalIdSchema }),
      outputSchema: menuOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ menuId }) => runMcpTool('content.project.menu.get', async () =>
      getProjectMenu(mcpId(menuId, 'menuId'))),
  )

  server.defineTool(
    'content.project.menu.create',
    {
      title: '创建项目菜单',
      description: '创建项目菜单项，修改可能立即影响公开导航。',
      inputSchema: z.strictObject({ projectId: decimalIdSchema, ...menuValuesSchema }),
      outputSchema: menuBaseOutputSchema,
      annotations: CREATE_ANNOTATIONS,
    },
    async ({ projectId, parentId, label, url, isExternal, weight, status }) =>
      runMcpTool('content.project.menu.create', async () => createProjectMenu(
        mcpId(projectId, 'projectId'),
        { parentId, label, url, isExternal, weight, status },
      )),
  )

  server.defineTool(
    'content.project.menu.update',
    {
      title: '更新项目菜单',
      description: '更新菜单层级、标签、地址、权重或状态，不删除或恢复菜单。',
      inputSchema: z.strictObject({
        menuId: decimalIdSchema,
        parentId: decimalIdSchema.nullable().optional(),
        label: menuValuesSchema.label.optional(),
        url: menuValuesSchema.url,
        isExternal: z.boolean().optional(),
        weight: databaseIntegerSchema.optional(),
        status: statusSchema.optional(),
      }).refine(
        ({ parentId, label, url, isExternal, weight, status }) =>
          parentId !== undefined || label !== undefined || url !== undefined ||
          isExternal !== undefined || weight !== undefined || status !== undefined,
        { message: '至少提供一个需要更新的菜单字段。' },
      ),
      outputSchema: menuBaseOutputSchema,
      annotations: UPDATE_ANNOTATIONS,
    },
    async ({ menuId, parentId, label, url, isExternal, weight, status }) =>
      runMcpTool('content.project.menu.update', async () => updateProjectMenu(
        mcpId(menuId, 'menuId'),
        { parentId, label, url, isExternal, weight, status },
      )),
  )

  server.defineTool(
    'content.homepage.get',
    {
      title: '读取系统首页',
      description: '读取当前未删除的系统首页正文。该工具只读。',
      inputSchema: z.strictObject({}),
      outputSchema: homepageOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => runMcpTool('content.homepage.get', getSystemHomepage),
  )

  server.defineTool(
    'content.homepage.create',
    {
      title: '创建系统首页',
      description: '创建新的系统首页记录，可能立即影响公开首页。',
      inputSchema: z.strictObject({
        content: z.string().max(DOCUMENT_CONTENT_MAX_CHARACTERS),
        status: statusSchema.default(1),
      }),
      outputSchema: homepageOutputSchema,
      annotations: CREATE_ANNOTATIONS,
    },
    async ({ content, status }) => runMcpTool('content.homepage.create', async () =>
      createSystemHomepage({ content, status })),
  )

  server.defineTool(
    'content.homepage.update',
    {
      title: '更新系统首页',
      description: '更新系统首页正文或状态，不删除或恢复首页。',
      inputSchema: z.strictObject({
        homepageId: decimalIdSchema,
        content: z.string().max(DOCUMENT_CONTENT_MAX_CHARACTERS).optional(),
        status: statusSchema.optional(),
      }).refine(
        ({ content, status }) => content !== undefined || status !== undefined,
        { message: '至少提供 content 或 status。' },
      ),
      outputSchema: homepageOutputSchema,
      annotations: UPDATE_ANNOTATIONS,
    },
    async ({ homepageId, content, status }) => runMcpTool('content.homepage.update', async () =>
      updateSystemHomepage(mcpId(homepageId, 'homepageId'), { content, status })),
  )
})
