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

function fileToDto(file: any) {
  return {
    id: file.id.toString(),
    originalName: file.originalName,
    fileName: file.fileName,
    filePath: file.filePath,
    fileSize: file.fileSize.toString(),
    businessType: file.businessType,
    status: file.status,
    createTime: file.createTime,
    url: `/${file.filePath}`,
  }
}

export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  const query = getQuery(event)
  const page = Math.max(1, toInt(query.page, 1))
  const pageSize = Math.min(100, Math.max(1, toInt(query.pageSize, 10)))

  const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : ''
  const businessType = typeof query.businessType === 'string' ? query.businessType : undefined
  const status = query.status !== undefined ? toInt(query.status, Number.NaN) : undefined
  const includeDeleted = toBool(query.includeDeleted)

  const orderByField = typeof query.orderBy === 'string' ? query.orderBy : 'createTime'
  const order = typeof query.order === 'string' && query.order.toLowerCase() === 'asc' ? 'asc' : 'desc'

  const where: any = {}

  // 默认只查询正常状态的文件
  if (!includeDeleted) {
    where.status = 1
  } else if (Number.isFinite(status)) {
    where.status = status
  }

  if (keyword) {
    where.originalName = { contains: keyword, mode: 'insensitive' }
  }

  if (businessType) {
    where.businessType = businessType
  }

  const allowedOrderBy = new Set(['id', 'originalName', 'fileSize', 'businessType', 'createTime'])
  const safeOrderBy = allowedOrderBy.has(orderByField) ? orderByField : 'createTime'

  const skip = (page - 1) * pageSize

  try {
    const [total, list] = await Promise.all([
      prisma.fileManagement.count({ where }),
      prisma.fileManagement.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { [safeOrderBy]: order },
      }),
    ])

    return ok({
      list: list.map(fileToDto),
      page,
      pageSize,
      total,
    })
  } catch (err) {
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
