/**
 * @file note-content.ts
 * @project SlothVault
 * @module MCP Note Content Tools
 * @description Registers administrator MCP note-content version listing, full reads, draft creation, draft updates, and primary selection.
 * @logic Keep history listings lightweight, expose full Markdown only through explicit reads, and separate primary selection from ordinary content updates while inheriting draft locks.
 * @dependencies MCP TypeScript SDK, zod, document content limits, services/admin-notes, mcp tool contracts
 * @index_tags mcp,tools,note-content,markdown,versions,primary,draft
 * @author holic512
 */
import 'server-only'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { DOCUMENT_CONTENT_MAX_CHARACTERS } from '@/lib/document-content'
import {
  createAdminNoteContent,
  getAdminNoteContent,
  listAdminNoteContentVersions,
  updateAdminNoteContent,
} from '@/server/services/admin-notes'

import {
  CREATE_ANNOTATIONS,
  decimalIdSchema,
  isoDateSchema,
  mcpId,
  READ_ONLY_ANNOTATIONS,
  runMcpTool,
  statusSchema,
  UPDATE_ANNOTATIONS,
} from './common'

const noteContentVersionOutputSchema = z.object({
  id: decimalIdSchema,
  noteInfoId: decimalIdSchema,
  versionNote: z.string().nullable(),
  isPrimary: z.boolean(),
  status: z.number().int(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  isDeleted: z.boolean(),
})

const noteContentOutputSchema = noteContentVersionOutputSchema.extend({
  content: z.string(),
})

const updateContentSchema = z.strictObject({
  noteContentId: decimalIdSchema,
  content: z.string().max(DOCUMENT_CONTENT_MAX_CHARACTERS).optional(),
  versionNote: z.string().trim().max(255).nullable().optional(),
  status: statusSchema.optional(),
}).refine(
  ({ content, versionNote, status }) =>
    content !== undefined || versionNote !== undefined || status !== undefined,
  { message: '至少提供 content、versionNote 或 status 之一。' },
)

export function registerNoteContentTools(server: McpServer) {
  server.registerTool(
    'content.note.content.list_versions',
    {
      title: '列出笔记正文版本',
      description: '列出未删除正文版本的轻量元数据，不返回 Markdown 正文。该工具只读。',
      inputSchema: z.strictObject({ noteId: decimalIdSchema }),
      outputSchema: z.object({ list: z.array(noteContentVersionOutputSchema) }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ noteId }) => runMcpTool('content.note.content.list_versions', async () =>
      listAdminNoteContentVersions(mcpId(noteId, 'noteId'))),
  )

  server.registerTool(
    'content.note.content.get',
    {
      title: '读取笔记正文',
      description: '按正文版本 ID 读取完整 Markdown 与版本元数据。该工具只读。',
      inputSchema: z.strictObject({ noteContentId: decimalIdSchema }),
      outputSchema: noteContentOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ noteContentId }) => runMcpTool('content.note.content.get', async () =>
      getAdminNoteContent(mcpId(noteContentId, 'noteContentId'))),
  )

  server.registerTool(
    'content.note.content.create_draft',
    {
      title: '创建笔记正文草稿',
      description: '在未发布版本中创建正文历史项；首个未删除正文会自动成为主版本。',
      inputSchema: z.strictObject({
        noteId: decimalIdSchema,
        content: z.string().max(DOCUMENT_CONTENT_MAX_CHARACTERS).default(''),
        versionNote: z.string().trim().max(255).nullable().default(null),
        status: statusSchema.default(1),
      }),
      outputSchema: noteContentOutputSchema,
      annotations: CREATE_ANNOTATIONS,
    },
    async ({ noteId, content, versionNote, status }) =>
      runMcpTool('content.note.content.create_draft', async () => createAdminNoteContent({
        noteInfoId: noteId,
        content,
        versionNote,
        status,
        isPrimary: false,
      })),
  )

  server.registerTool(
    'content.note.content.update_draft',
    {
      title: '更新笔记正文草稿',
      description: '更新正文 Markdown、版本说明或启用状态；不删除且不切换主版本。',
      inputSchema: updateContentSchema,
      outputSchema: noteContentOutputSchema,
      annotations: UPDATE_ANNOTATIONS,
    },
    async ({ noteContentId, content, versionNote, status }) =>
      runMcpTool('content.note.content.update_draft', async () => updateAdminNoteContent(
        mcpId(noteContentId, 'noteContentId'),
        { content, versionNote, status },
      )),
  )

  server.registerTool(
    'content.note.content.set_primary',
    {
      title: '设置主正文草稿',
      description: '将指定未删除正文设为主版本，并在同一事务中取消该笔记的其他主版本。',
      inputSchema: z.strictObject({ noteContentId: decimalIdSchema }),
      outputSchema: noteContentOutputSchema,
      annotations: UPDATE_ANNOTATIONS,
    },
    async ({ noteContentId }) => runMcpTool('content.note.content.set_primary', async () =>
      updateAdminNoteContent(mcpId(noteContentId, 'noteContentId'), { isPrimary: true })),
  )
}
