/**
 * @file project-documentation.ts
 * @project SlothVault
 * @module MCP Project Documentation Tools
 * @description Exposes lightweight version outlines and bounded, atomic project documentation operations.
 * @logic Validate real IDs and revisions, delegate to services, and retain native MCP authorization and structured responses.
 * @dependencies MCP registry, project-documentation service and contracts, note-content output schema
 * @index_tags mcp,documentation,outline,batch,baseline
 * @author holic512
 */
import 'server-only'
import { z } from 'zod'
import { collectMcpToolDefinitions } from '@/server/mcp/registry'
import { applyDocumentationDraftSchema, documentationStateSchema } from '@/lib/project-documentation'
import { applyDocumentationDraft, getDocumentationOutline, getManyNoteContents } from '@/server/services/project-documentation'
import { decimalIdSchema, isoDateSchema, mcpId, pageSchema, pageSizeSchema, paginationOutputShape, READ_ONLY_ANNOTATIONS, runMcpTool, UPDATE_ANNOTATIONS } from './common'
import { noteContentOutputSchema } from './note-content'
export const projectDocumentationToolDefinitions = collectMcpToolDefinitions(server => {
  server.defineTool('content.project.version.outline', {
    title: '读取项目文档轻量索引',
    description: '只读分页返回文档键、主正文 ID、修订号、实际阅读 URL 和源码基线，不返回 Markdown。pageSize 最大 50；documentationState.documents 仅含本页笔记，请按页合并。',
    inputSchema: z.strictObject({ projectVersionId: decimalIdSchema, page: pageSchema, pageSize: pageSizeSchema }),
    outputSchema: z.object({ projectVersionId: decimalIdSchema, projectId: decimalIdSchema, version: z.string(), publishedAt: isoDateSchema.nullable(), documentRevision: z.number().int(), documentationState: documentationStateSchema,
      categories: z.array(z.object({ id: decimalIdSchema, key: z.string().nullable(), categoryName: z.string(), status: z.number().int(), weight: z.number().int() })),
      list: z.array(z.object({ id: decimalIdSchema, key: z.string().nullable(), categoryId: decimalIdSchema, noteTitle: z.string(), status: z.number().int(), weight: z.number().int(), tags: z.array(z.string()), contentRevision: z.number().int(), primaryContentId: decimalIdSchema.nullable(), primaryContentStatus: z.number().int().nullable(), url: z.string() })), ...paginationOutputShape }),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ projectVersionId, page, pageSize }) => runMcpTool('content.project.version.outline', () => getDocumentationOutline(mcpId(projectVersionId, 'projectVersionId'), page, pageSize)))
  server.defineTool('content.note.content.get_many', {
    title: '批量读取指定笔记正文', description: '只读完整读取最多 20 个唯一正文 ID，正文 UTF-8 合计最多 512 KiB。超限请拆批或单篇读取，不会截断正文。',
    inputSchema: z.strictObject({ noteContentIds: z.array(decimalIdSchema).min(1).max(20).refine(ids => new Set(ids.map(Number)).size === ids.length) }),
    outputSchema: z.object({ list: z.array(noteContentOutputSchema) }), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ noteContentIds }) => runMcpTool('content.note.content.get_many', () => getManyNoteContents(noteContentIds.map(id => mcpId(id, 'noteContentIds')))))
  server.defineTool('content.project.version.apply_draft', {
    title: '批量同步项目文档草稿', description: '按 expectedRevision 原子写入最多 20 项分类/笔记变更，正文合计最多 512 KiB。稳定键与标题独立。targetBaseline+plannedDocumentKeys 开始待完成更新；finalize 在所有键完成且文档树、更新日志通过后确认基线。返回本批次文档映射，不重复返回整套映射。不会发布或改变权限；冲突/超时先回读 outline。',
    inputSchema: applyDocumentationDraftSchema,
    outputSchema: z.object({ projectVersionId: decimalIdSchema, documentRevision: z.number().int(), changed: z.boolean(), documentationState: documentationStateSchema,
      results: z.array(z.object({ type: z.enum(['category', 'note']), key: z.string(), categoryId: decimalIdSchema, noteId: decimalIdSchema.optional(), primaryContentId: decimalIdSchema.optional() })) }),
    annotations: UPDATE_ANNOTATIONS,
  }, async (input, context) => runMcpTool('content.project.version.apply_draft', () => applyDocumentationDraft(input, context.principal.userId)))
})
