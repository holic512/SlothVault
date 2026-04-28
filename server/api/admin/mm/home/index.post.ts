import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { readBody, setResponseStatus } from 'h3'

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

interface CreateHomeBody {
  projectId: string
  content: string
  status?: number
}

/**
 * 创建项目首页内容
 * POST /api/admin/mm/home
 */
export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  const body = await readBody<CreateHomeBody>(event)

  if (!body?.projectId) {
    setResponseStatus(event, 400)
    return fail('Missing projectId', 400)
  }

  if (body?.content === undefined || body?.content === null) {
    setResponseStatus(event, 400)
    return fail('Missing content', 400)
  }

  let projectId: bigint
  try {
    projectId = BigInt(body.projectId)
  } catch {
    setResponseStatus(event, 400)
    return fail('Invalid projectId', 400)
  }

  try {
    const home = await prisma.projectHome.create({
      data: {
        projectId,
        content: body.content,
        status: body.status ?? 1,
      },
    })

    setResponseStatus(event, 201)
    return ok(homeToDto(home), 'created')
  } catch (err: any) {
    if (err?.code === 'P2002') {
      setResponseStatus(event, 400)
      return fail('Project home already exists', 400)
    }
    if (err?.code === 'P2003') {
      setResponseStatus(event, 400)
      return fail('Invalid projectId', 400)
    }
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
