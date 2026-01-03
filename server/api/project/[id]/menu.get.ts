import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { setResponseStatus, getRouterParam } from 'h3'

interface MenuDto {
  id: string
  label: string
  url: string | null
  isExternal: boolean
  weight: number
  children: MenuDto[]
}

function menuToDto(menu: any): MenuDto {
  return {
    id: menu.id.toString(),
    label: menu.label,
    url: menu.url,
    isExternal: menu.isExternal,
    weight: menu.weight,
    children: menu.children?.map(menuToDto) ?? [],
  }
}

/**
 * 获取项目菜单（公开接口，树形结构）
 * GET /api/project/:id/menu
 */
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
    // 验证项目存在且启用
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

    // 获取树形菜单
    const list = await prisma.projectMenu.findMany({
      where: {
        projectId,
        parentId: null,
        isDeleted: false,
        status: 1,
      },
      include: {
        children: {
          where: { isDeleted: false, status: 1 },
          orderBy: { weight: 'desc' },
        },
      },
      orderBy: { weight: 'desc' },
    })

    return ok(list.map(menuToDto))
  } catch (err) {
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
