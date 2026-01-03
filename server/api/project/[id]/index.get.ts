import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { setResponseStatus, getRouterParam } from 'h3'

interface ProjectDetailDto {
  id: string
  projectName: string
  avatar: string | null
  requireAuth: boolean
  status: number
  updatedAt: Date
}

function projectToDto(project: any): ProjectDetailDto {
  return {
    id: project.id.toString(),
    projectName: project.projectName,
    avatar: project.avatar,
    requireAuth: project.requireAuth,
    status: project.status,
    updatedAt: project.updatedAt,
  }
}

/**
 * 获取单个项目详情
 * GET /api/project/:id
 */
export default defineEventHandler(async (event) => {
  const idRaw = getRouterParam(event, 'id')

  if (!idRaw) {
    setResponseStatus(event, 400)
    return fail('Missing project id', 400)
  }

  let projectId: bigint
  try {
    projectId = BigInt(idRaw)
  } catch {
    setResponseStatus(event, 400)
    return fail('Invalid project id', 400)
  }

  try {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        isDeleted: false,
        status: 1,
      },
    })

    if (!project) {
      setResponseStatus(event, 404)
      return fail('Project not found', 404)
    }

    return ok(projectToDto(project))
  } catch (err) {
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
