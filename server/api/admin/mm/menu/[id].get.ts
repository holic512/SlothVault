import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { getRouterParam, setResponseStatus } from 'h3'

function menuToDto(menu: any) {
  return {
    id: menu.id.toString(),
    projectId: menu.projectId.toString(),
    parentId: menu.parentId?.toString() ?? null,
    label: menu.label,
    url: menu.url,
    isExternal: menu.isExternal,
    weight: menu.weight,
    status: menu.status,
    createdAt: menu.createdAt,
    updatedAt: menu.updatedAt,
    isDeleted: menu.isDeleted,
    children: menu.children?.map(menuToDto) ?? [],
  }
}

/**
 * 获取单个菜单详情
 * GET /api/admin/mm/menu/:id
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
    const menu = await prisma.projectMenu.findUnique({
      where: { id },
      include: {
        children: {
          where: { isDeleted: false },
          orderBy: { weight: 'desc' },
        },
      },
    })

    if (!menu) {
      setResponseStatus(event, 404)
      return fail('Not Found', 404)
    }

    return ok(menuToDto(menu))
  } catch (err) {
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
