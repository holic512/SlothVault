import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { getQuery, setResponseStatus } from 'h3'

function homeToDto(home: any) {
  return {
    id: home.id.toString(),
    projectId: home.projectId.toString(),
    content: home.content,
    status: home.status,
    createdAt: home.createdAt,
    updatedAt: home.updatedAt,
    isDeleted: home.isDeleted,
  }
}

/**
 * 根据项目ID获取首页内容
 * GET /api/admin/mm/home?projectId=1
 */
export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  const query = getQuery(event)
  const projectIdRaw = query.projectId

  if (!projectIdRaw) {
    setResponseStatus(event, 400)
    return fail('Missing projectId', 400)
  }

  let projectId: bigint
  try {
    projectId = BigInt(projectIdRaw as string)
  } catch {
    setResponseStatus(event, 400)
    return fail('Invalid projectId', 400)
  }

  try {
    const home = await prisma.projectHome.findUnique({
      where: { projectId },
    })

    if (!home) {
      setResponseStatus(event, 404)
      return fail('Not Found', 404)
    }

    return ok(homeToDto(home))
  } catch (err) {
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
