import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { getRouterParam, setResponseStatus } from 'h3'

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
 * 获取单个首页详情
 * GET /api/admin/mm/home/:id
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
    const home = await prisma.projectHome.findUnique({
      where: { id },
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
