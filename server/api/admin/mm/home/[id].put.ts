import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { getRouterParam, readBody, setResponseStatus } from 'h3'

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

interface UpdateHomeBody {
  content?: string
  status?: number
}

/**
 * 更新首页内容
 * PUT /api/admin/mm/home/:id
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

  const body = await readBody<UpdateHomeBody>(event)
  const data: any = { updatedAt: new Date() }

  if (body?.content !== undefined) {
    data.content = body.content
  }

  if (body?.status !== undefined) {
    data.status = body.status
  }

  if (Object.keys(data).length === 1) {
    setResponseStatus(event, 400)
    return fail('No fields to update', 400)
  }

  try {
    const home = await prisma.projectHome.update({
      where: { id },
      data,
    })
    return ok(homeToDto(home))
  } catch (err: any) {
    if (err?.code === 'P2025') {
      setResponseStatus(event, 404)
      return fail('Not Found', 404)
    }
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
