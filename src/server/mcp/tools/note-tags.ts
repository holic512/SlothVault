/**
 * @file note-tags.ts
 * @project SlothVault
 * @module MCP Note Tag Tools
 * @description Registers single-note tag reads, idempotent additions and removals, and explicit renames.
 * @logic Expose narrow tag inputs and the resulting complete tag list, delegating atomic draft-only writes to the note-tag service.
 * @dependencies zod, lib/note-tags, mcp registry, services/admin-note-tags
 * @index_tags mcp,notes,tags,crud,draft
 * @author holic512
 */
import 'server-only'

import { z } from 'zod'
import { noteTagSchema, noteTagsSchema } from '@/lib/note-tags'
import { collectMcpToolDefinitions } from '@/server/mcp/registry'
import { addAdminNoteTag, listAdminNoteTags, removeAdminNoteTag, renameAdminNoteTag } from '@/server/services/admin-note-tags'
import { decimalIdSchema, IDEMPOTENT_UPDATE_ANNOTATIONS, mcpId, READ_ONLY_ANNOTATIONS, runMcpTool, UPDATE_ANNOTATIONS } from './common'

const noteTagsOutputSchema = z.object({ noteId: decimalIdSchema, tags: noteTagsSchema })
const tagInputSchema = z.strictObject({ noteId: decimalIdSchema, tag: noteTagSchema })

export const noteTagToolDefinitions = collectMcpToolDefinitions((server) => {
  server.defineTool(
    'content.note.tag.list',
    {
      title: '读取笔记标签',
      description: '读取指定未删除笔记的全部标签，不返回正文；草稿和已发布版本均可读取。',
      inputSchema: z.strictObject({ noteId: decimalIdSchema }),
      outputSchema: noteTagsOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ noteId }) => runMcpTool('content.note.tag.list', async () => listAdminNoteTags(mcpId(noteId, 'noteId'))),
  )
  server.defineTool(
    'content.note.tag.add',
    {
      title: '添加笔记标签',
      description: '为草稿笔记添加一个标签，保留其他标签；已有同名标签时不重复添加。最多 10 个标签，每个最多 30 个字符。',
      inputSchema: tagInputSchema,
      outputSchema: noteTagsOutputSchema,
      annotations: IDEMPOTENT_UPDATE_ANNOTATIONS,
    },
    async ({ noteId, tag }) => runMcpTool('content.note.tag.add', async () => addAdminNoteTag(mcpId(noteId, 'noteId'), tag)),
  )
  server.defineTool(
    'content.note.tag.rename',
    {
      title: '重命名笔记标签',
      description: '重命名草稿笔记的一个标签并保持顺序；原标签不存在返回 404，新名称已被其他标签使用返回 409。',
      inputSchema: z.strictObject({ noteId: decimalIdSchema, tag: noteTagSchema, newTag: noteTagSchema }),
      outputSchema: noteTagsOutputSchema,
      annotations: UPDATE_ANNOTATIONS,
    },
    async ({ noteId, tag, newTag }) => runMcpTool('content.note.tag.rename', async () => renameAdminNoteTag(mcpId(noteId, 'noteId'), tag, newTag)),
  )
  server.defineTool(
    'content.note.tag.remove',
    {
      title: '移除笔记标签',
      description: '移除草稿笔记的一个标签，保留其他标签；标签不存在时直接返回当前列表。',
      inputSchema: tagInputSchema,
      outputSchema: noteTagsOutputSchema,
      annotations: IDEMPOTENT_UPDATE_ANNOTATIONS,
    },
    async ({ noteId, tag }) => runMcpTool('content.note.tag.remove', async () => removeAdminNoteTag(mcpId(noteId, 'noteId'), tag)),
  )
})
