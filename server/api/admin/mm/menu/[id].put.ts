import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { getRouterParam, readBody, setResponseStatus } from 'h3'

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

interface UpdateMenuBody {
  parentId?: string | null
  label?: string
  url?: string | null
  isExternal?: boolean
  weight?: number
  status?: number
}

/**
 * 更新菜单
 * PUT /api/admin/mm/menu/:id
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

  const body = await readBody<UpdateMenuBody>(event)
  const data: any = { updatedAt: new Date() }

  // 处理 parentId 更新
  if (body?.parentId !== undefined) {
    if (body.parentId === null || body.parentId === '') {
      data.parentId = null
    } else {
      try {
        const parentId = BigInt(body.parentId)
        // 验证父级菜单层级
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
        // 不能将自己设为父级
        if (parentId === id) {
          setResponseStatus(event, 400)
          return fail('Cannot set self as parent', 400)
        }
        data.parentId = parentId
      } catch {
        setResponseStatus(event, 400)
        return fail('Invalid parentId', 400)
      }
    }
  }

  if (body?.label !== undefined) {
    if (!body.label.trim()) {
      setResponseStatus(event, 400)
      return fail('Label cannot be empty', 400)
    }
    data.label = body.label.trim()
  }

  if (body?.url !== undefined) {
    data.url = body.url?.trim() || null
  }

  if (body?.isExternal !== undefined) {
    data.isExternal = body.isExternal
  }

  if (body?.weight !== undefined) {
    data.weight = body.weight
  }

  if (body?.status !== undefined) {
    data.status = body.status
  }

  if (Object.keys(data).length === 1) {
    setResponseStatus(event, 400)
    return fail('No fields to update', 400)
  }

  try {
    const menu = await prisma.projectMenu.update({
      where: { id },
      data,
    })
    return ok(menuToDto(menu))
  } catch (err: any) {
    if (err?.code === 'P2025') {
      setResponseStatus(event, 404)
      return fail('Not Found', 404)
    }
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
