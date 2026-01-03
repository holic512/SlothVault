import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { setResponseStatus, getRouterParam } from 'h3'

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

    const home = await prisma.projectHome.findUnique({
      where: { projectId },
    })

    if (!home || home.isDeleted || home.status !== 1) {
      setResponseStatus(event, 404)
      return fail('Home content not found', 404)
    }

    return ok({
      id: home.id.toString(),
      projectId: home.projectId.toString(),
      content: home.content,
      updatedAt: home.updatedAt,
    })
  } catch (err) {
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
