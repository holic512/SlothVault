import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { readBody, setResponseStatus } from 'h3'

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
  }
}

interface CreateMenuBody {
  projectId: string
  parentId?: string | null
  label: string
  url?: string | null
  isExternal?: boolean
  weight?: number
  status?: number
}

/**
 * 创建项目菜单
 * POST /api/admin/mm/menu
 */
export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  const body = await readBody<CreateMenuBody>(event)

  if (!body?.projectId) {
    setResponseStatus(event, 400)
    return fail('Missing projectId', 400)
  }

  if (!body?.label?.trim()) {
    setResponseStatus(event, 400)
    return fail('Missing label', 400)
  }

  let projectId: bigint
  try {
    projectId = BigInt(body.projectId)
  } catch {
    setResponseStatus(event, 400)
    return fail('Invalid projectId', 400)
  }

  let parentId: bigint | null = null
  if (body.parentId) {
    try {
      parentId = BigInt(body.parentId)
    } catch {
      setResponseStatus(event, 400)
      return fail('Invalid parentId', 400)
    }
  }

  // 验证父级菜单层级（最多二级）
  if (parentId) {
    const parentMenu = await prisma.projectMenu.findUnique({
      where: { id: parentId },
    })
    if (!parentMenu) {
      setResponseStatus(event, 400)
      return fail('Parent menu not found', 400)
    }
    if (parentMenu.parentId !== null) {
      setResponseStatus(event, 400)
      return fail('Maximum menu depth is 2 levels', 400)
    }
  }

  try {
    const menu = await prisma.projectMenu.create({
      data: {
        projectId,
        parentId,
        label: body.label.trim(),
        url: body.url?.trim() || null,
        isExternal: body.isExternal ?? false,
        weight: body.weight ?? 0,
        status: body.status ?? 1,
      },
    })

    setResponseStatus(event, 201)
    return ok(menuToDto(menu), 'created')
  } catch (err: any) {
    if (err?.code === 'P2003') {
      setResponseStatus(event, 400)
      return fail('Invalid projectId or parentId', 400)
    }
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
