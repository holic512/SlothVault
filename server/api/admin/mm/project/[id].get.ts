import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { getRouterParam, setResponseStatus } from 'h3'

function projectToDto(project: any) {
  return {
    id: project.id.toString(),
    projectName: project.projectName,
    avatar: project.avatar,
    weight: project.weight,
    status: project.status,
    requireAuth: project.requireAuth,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    isDeleted: project.isDeleted,
  }
}

/**
 * 获取单个项目详情
 * GET /api/admin/mm/project/:id
 */
export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  const idRaw = getRouterParam(event, 'id')
  if (!idRaw) {
    setResponseStatus(event, 400)
    return fail('Missing id', 400)
  }

  let id: bigint
  try {
    id = BigInt(idRaw)
  } catch {
    setResponseStatus(event, 400)
    return fail('Invalid id', 400)
  }

  try {
    const project = await prisma.project.findUnique({
      where: { id },
    })

    if (!project) {
      setResponseStatus(event, 404)
      return fail('Not Found', 404)
    }

    return ok(projectToDto(project))
  } catch (err) {
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
