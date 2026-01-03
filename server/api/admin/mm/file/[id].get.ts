import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { getRouterParam, setResponseStatus } from 'h3'

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

  try {
    const file = await prisma.fileManagement.findUnique({
      where: { id },
    })

    if (!file) {
      setResponseStatus(event, 404)
      return fail('Not Found', 404)
    }

    return ok(fileToDto(file))
  } catch (err) {
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
