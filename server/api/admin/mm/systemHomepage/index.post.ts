import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { readBody, setResponseStatus } from 'h3'

/**
 * 创建系统首页内容
 * POST /api/admin/mm/systemHomepage
 */
export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  const body = await readBody(event)
  const { content, status } = body

  if (!content || typeof content !== 'string') {
    setResponseStatus(event, 400)
    return fail('Invalid content', 400)
  }

  try {
    const homepage = await prisma.systemHomepage.create({
      data: {
        content,
        status: status ?? 1,
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
    console.error('Error creating system homepage:', err)
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
