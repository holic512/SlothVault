import { readSession } from '~~/server/utils/session'
import { ok, fail } from '~~/server/utils/response'
import { setResponseStatus } from 'h3'
import archiver from 'archiver'
import { createReadStream, statSync } from 'fs'
import { join } from 'path'

export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  try {
    // 使用环境变量判断是否为生产环境（Docker 部署）
    const isProduction = process.env.NODE_ENV === 'production'
    const publicDir = isProduction
      ? join(process.cwd(), '.output', 'public')
      : join(process.cwd(), 'public')
    const uploadsDir = join(publicDir, 'uploads')

    // 检查目录是否存在
    try {
      statSync(uploadsDir)
    } catch {
      setResponseStatus(event, 404)
      return fail('Uploads directory not found', 404)
    }

    // 设置响应头
    event.node.res.setHeader('Content-Type', 'application/zip')
    event.node.res.setHeader('Content-Disposition', `attachment; filename="uploads-backup-${Date.now()}.zip"`)

    // 创建 zip 压缩流
    const archive = archiver('zip', {
      zlib: { level: 9 } // 最高压缩级别
    })

    // 错误处理
    archive.on('error', (err) => {
      console.error('Archive error:', err)
      throw err
    })

    // 将压缩流输出到响应
    archive.pipe(event.node.res)

    // 添加整个 uploads 目录到压缩包
    archive.directory(uploadsDir, false)

    // 完成压缩
    await archive.finalize()

    return
  } catch (err) {
    console.error('Files export error:', err)
    setResponseStatus(event, 500)
    return fail('Files export failed', 500)
  }
})
