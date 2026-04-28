import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { readBody, setResponseStatus } from 'h3'

/**
 * 更新系统首页内容
 * PUT /api/admin/mm/systemHomepage/[id]
 */
export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  const idRaw = event.context.params?.id
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

  const body = await readBody(event)
  const { content, status } = body

  try {
    const homepage = await prisma.systemHomepage.update({
      where: { id },
      data: {
        ...(content !== undefined && { content }),
        ...(status !== undefined && { status }),
        updatedAt: new Date(),
      },
    })

    return ok({
      id: homepage.id.toString(),
      content: homepage.content,
      status: homepage.status,
      createdAt: homepage.createdAt,
      updatedAt: homepage.updatedAt,
      isDeleted: homepage.isDeleted,
    })
  } catch (err) {
    console.error('Error updating system homepage:', err)
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
