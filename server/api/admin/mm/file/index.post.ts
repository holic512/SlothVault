import { uploadFiles, ValidBusinessTypes, type BusinessType } from '~~/server/utils/file'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { getQuery, setResponseStatus } from 'h3'

function toInt(value: unknown, fallback: number) {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

/**
 * 通用文件上传接口
 * POST /api/admin/mm/file?businessType=NoteAttachment
 * Content-Type: multipart/form-data
 */
export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  const query = getQuery(event)
  const businessType = (typeof query.businessType === 'string' ? query.businessType : 'Other') as BusinessType
  const maxSize = toInt(query.maxSize, 10 * 1024 * 1024) // 默认 10MB

  // 验证业务类型
  if (!ValidBusinessTypes.includes(businessType)) {
    setResponseStatus(event, 400)
    return fail('Invalid businessType', 400)
  }

  try {
    const results = await uploadFiles(event, {
      businessType,
      maxSize,
    })

    if (results.length === 0) {
      setResponseStatus(event, 400)
      return fail('未检测到上传文件', 400)
    }

    const files = results.map((file) => ({
      id: file.id.toString(),
      url: file.url,
      originalName: file.originalName,
      fileName: file.fileName,
      filePath: file.filePath,
      fileSize: file.fileSize.toString(),
      businessType: file.businessType,
    }))

    setResponseStatus(event, 201)
    return ok(files, 'uploaded')
  } catch (err: any) {
    setResponseStatus(event, err.statusCode || 500)
    return fail(err.message || '上传失败', err.statusCode || 500)
  }
})
