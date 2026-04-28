import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { getQuery, setResponseStatus } from 'h3'

function toInt(value: unknown, fallback: number) {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function toBool(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false
  return value === '1' || value.toLowerCase() === 'true'
}

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
 * 获取项目菜单列表
 * GET /api/admin/mm/menu?projectId=1&tree=true&includeDeleted=false
 */
export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  const query = getQuery(event)
  const projectIdRaw = query.projectId
  const tree = toBool(query.tree)
  const includeDeleted = toBool(query.includeDeleted)

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

  const where: any = { projectId }
  if (!includeDeleted) {
    where.isDeleted = false
  }

  try {
    if (tree) {
      // 树形结构：只查询一级菜单，包含子菜单
      const list = await prisma.projectMenu.findMany({
        where: { ...where, parentId: null },
        include: {
          children: {
            where: includeDeleted ? {} : { isDeleted: false },
            orderBy: { weight: 'desc' },
          },
        },
        orderBy: { weight: 'desc' },
      })
      return ok(list.map(menuToDto))
    } else {
      // 平铺结构
      const list = await prisma.projectMenu.findMany({
        where,
        orderBy: { weight: 'desc' },
      })
      return ok(list.map(menuToDto))
    }
  } catch (err) {
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
