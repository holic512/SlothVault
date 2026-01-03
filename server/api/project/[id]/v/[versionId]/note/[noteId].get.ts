import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { setResponseStatus, getRouterParam } from 'h3'

interface NoteContentDto {
  id: string
  noteId: string
  noteTitle: string
  content: string
  versionNote: string | null
  updatedAt: Date
}

/**
 * 获取笔记内容（公开接口，返回主显示版本）
 * GET /api/project/:id/v/:versionId/note/:noteId
 */
export default defineEventHandler(async (event) => {
  const projectIdRaw = getRouterParam(event, 'id')
  const versionIdRaw = getRouterParam(event, 'versionId')
  const noteIdRaw = getRouterParam(event, 'noteId')

  if (!projectIdRaw || !versionIdRaw || !noteIdRaw) {
    setResponseStatus(event, 400)
    return fail('Missing required parameters', 400)
  }

  let projectId: bigint
  let versionId: bigint
  let noteId: bigint
  try {
    projectId = BigInt(projectIdRaw)
    versionId = BigInt(versionIdRaw)
    noteId = BigInt(noteIdRaw)
  } catch {
    setResponseStatus(event, 400)
    return fail('Invalid parameters', 400)
  }

  try {
    // 验证笔记存在且属于正确的版本和项目
    const note = await prisma.noteInfo.findFirst({
      where: {
        id: noteId,
        isDeleted: false,
        status: 1,
        category: {
          projectVersionId: versionId,
          isDeleted: false,
          status: 1,
          projectVersion: {
            projectId,
            isDeleted: false,
            status: 1,
            project: {
              isDeleted: false,
              status: 1,
            },
          },
        },
      },
      select: {
        id: true,
        noteTitle: true,
      },
    })

    if (!note) {
      setResponseStatus(event, 404)
      return fail('Note not found', 404)
    }

    // 获取主显示版本的内容，如果没有主显示版本则取最新的
    let content = await prisma.noteContent.findFirst({
      where: {
        noteInfoId: noteId,
        isPrimary: true,
        isDeleted: false,
        status: 1,
      },
    })

    if (!content) {
      content = await prisma.noteContent.findFirst({
        where: {
          noteInfoId: noteId,
          isDeleted: false,
          status: 1,
        },
        orderBy: { createdAt: 'desc' },
      })
    }

    if (!content) {
      setResponseStatus(event, 404)
      return fail('Note content not found', 404)
    }

    const result: NoteContentDto = {
      id: content.id.toString(),
      noteId: note.id.toString(),
      noteTitle: note.noteTitle,
      content: content.content,
      versionNote: content.versionNote,
      updatedAt: content.updatedAt,
    }

    return ok(result)
  } catch (err) {
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
