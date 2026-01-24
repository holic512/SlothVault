import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { setResponseStatus } from 'h3'

function homepageToDto(homepage: any) {
  return {
    id: homepage.id.toString(),
    content: homepage.content,
    status: homepage.status,
    createdAt: homepage.createdAt,
    updatedAt: homepage.updatedAt,
    isDeleted: homepage.isDeleted,
  }
}

/**
 * 获取系统首页内容（获取第一条启用的记录）
 * GET /api/admin/mm/systemHomepage
 */
export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  try {
    const homepage = await prisma.systemHomepage.findFirst({
      where: {
        isDeleted: false,
      },
      orderBy: {
        id: 'desc',
      },
    })

    if (!homepage) {
      setResponseStatus(event, 404)
      return fail('Not Found', 404)
    }

    return ok(homepageToDto(homepage))
  } catch (err) {
    console.error('Error fetching system homepage:', err)
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
