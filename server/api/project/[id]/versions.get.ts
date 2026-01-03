import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { setResponseStatus, getRouterParam } from 'h3'

interface VersionDto {
  id: string
  version: string
  description: string | null
  weight: number
}

/**
 * 获取项目版本列表（公开接口）
 * GET /api/project/:id/versions
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
    // 验证项目存在且启用
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

    const versions = await prisma.projectVersion.findMany({
      where: {
        projectId,
        isDeleted: false,
        status: 1,
      },
      orderBy: { weight: 'desc' },
      select: {
        id: true,
        version: true,
        description: true,
        weight: true,
      },
    })

    const result: VersionDto[] = versions.map((v) => ({
      id: v.id.toString(),
      version: v.version,
      description: v.description,
      weight: v.weight,
    }))

    return ok(result)
  } catch (err) {
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
