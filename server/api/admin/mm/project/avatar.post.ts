import { uploadFiles } from '~~/server/utils/file'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { setResponseStatus } from 'h3'

/**
 * 项目头像上传接口
 * POST /api/admin/mm/project/avatar
 * Content-Type: multipart/form-data
 */
export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  try {
    const results = await uploadFiles(event, {
      businessType: 'ProjectAvatar',
      allowedExtensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
      maxSize: 2 * 1024 * 1024, // 2MB
    })

    if (results.length === 0) {
      setResponseStatus(event, 400)
      return fail('未检测到上传文件', 400)
    }

    const file = results[0]
    return ok({
      id: file.id.toString(),
      url: file.url,
      originalName: file.originalName,
      fileName: file.fileName,
      fileSize: file.fileSize.toString(),
    })
  } catch (err: any) {
    setResponseStatus(event, err.statusCode || 500)
    return fail(err.message || '上传失败', err.statusCode || 500)
  }
})
