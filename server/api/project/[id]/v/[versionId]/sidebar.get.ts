import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { setResponseStatus, getRouterParam } from 'h3'

interface NoteDto {
  id: string
  noteTitle: string
  weight: number
}

interface CategoryDto {
  id: string
  categoryName: string
  weight: number
  notes: NoteDto[]
}

/**
 * 获取版本下的分类和笔记树（公开接口，用于侧边栏）
 * GET /api/project/:id/v/:versionId/sidebar
 */
export default defineEventHandler(async (event) => {
  const projectIdRaw = getRouterParam(event, 'id')
  const versionIdRaw = getRouterParam(event, 'versionId')

  if (!projectIdRaw || !versionIdRaw) {
    setResponseStatus(event, 400)
    return fail('Missing required parameters', 400)
  }

  let projectId: bigint
  let versionId: bigint
  try {
    projectId = BigInt(projectIdRaw)
    versionId = BigInt(versionIdRaw)
  } catch {
    setResponseStatus(event, 400)
    return fail('Invalid parameters', 400)
  }

  try {
    // 验证项目和版本存在且启用
    const version = await prisma.projectVersion.findFirst({
      where: {
        id: versionId,
        projectId,
        isDeleted: false,
        status: 1,
      },
      include: {
        project: {
          select: { isDeleted: true, status: true },
        },
      },
    })

    if (!version || version.project.isDeleted || version.project.status !== 1) {
      setResponseStatus(event, 404)
      return fail('Version not found', 404)
    }

    // 获取分类及其下的笔记
    const categories = await prisma.category.findMany({
      where: {
        projectVersionId: versionId,
        isDeleted: false,
        status: 1,
      },
      orderBy: { weight: 'desc' },
      include: {
        noteInfos: {
          where: {
            isDeleted: false,
            status: 1,
          },
          orderBy: { weight: 'desc' },
          select: {
            id: true,
            noteTitle: true,
            weight: true,
          },
        },
      },
    })

    const result: CategoryDto[] = categories.map((cat) => ({
      id: cat.id.toString(),
      categoryName: cat.categoryName,
      weight: cat.weight,
      notes: cat.noteInfos.map((note) => ({
        id: note.id.toString(),
        noteTitle: note.noteTitle,
        weight: note.weight,
      })),
    }))

    return ok(result)
  } catch (err) {
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
