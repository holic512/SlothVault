import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { getRouterParam, readBody, setResponseStatus } from 'h3'
import { ValidBusinessTypes, type BusinessType } from '~~/server/utils/file'

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

  const body = await readBody<{
    businessType?: BusinessType
  }>(event)

  const data: any = {}

  // 验证业务类型
  if (body?.businessType !== undefined) {
    if (!ValidBusinessTypes.includes(body.businessType)) {
      setResponseStatus(event, 400)
      return fail('Invalid businessType', 400)
    }
    data.businessType = body.businessType
  }

  if (Object.keys(data).length === 0) {
    setResponseStatus(event, 400)
    return fail('No fields to update', 400)
  }

  try {
    const file = await prisma.fileManagement.update({
      where: { id },
      data,
    })
    return ok(fileToDto(file))
  } catch (err: any) {
    if (err?.code === 'P2025') {
      setResponseStatus(event, 404)
      return fail('Not Found', 404)
    }
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
