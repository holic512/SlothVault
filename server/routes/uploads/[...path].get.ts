import { readFile, stat } from 'fs/promises'
import { createError, defineEventHandler, setResponseHeaders } from 'h3'
import { join } from 'path'
import { existsSync } from 'fs'

/**
 * 文件代理接口
 * 路径: /uploads/**
 * 功能: 从 public/uploads 目录提供文件服务
 */
export default defineEventHandler(async (event) => {
  // 获取文件路径参数
  const path = event.context.params?.path || ''

  if (!path) {
    throw createError({
      statusCode: 400,
      message: 'File path is required'
    })
  }

  // 构建文件绝对路径
  const publicDir = join(process.cwd(), 'public')
  const filePath = join(publicDir, 'uploads', path)

  // 安全检查：防止路径穿越攻击
  if (!filePath.startsWith(join(publicDir, 'uploads'))) {
    throw createError({
      statusCode: 403,
      message: 'Access denied'
    })
  }

  // 检查文件是否存在
  if (!existsSync(filePath)) {
    throw createError({
      statusCode: 404,
      message: 'File not found'
    })
  }

  try {
    // 获取文件信息
    const stats = await stat(filePath)

    // 只允许访问文件，不允许访问目录
    if (!stats.isFile()) {
      throw createError({
        statusCode: 403,
        message: 'Access denied'
      })
    }

    // 读取文件内容
    const fileBuffer = await readFile(filePath)

    // 根据文件扩展名设置 Content-Type
    const ext = path.split('.').pop()?.toLowerCase()
    const contentTypeMap: Record<string, string> = {
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'pdf': 'application/pdf',
      'json': 'application/json',
      'txt': 'text/plain',
      'md': 'text/markdown',
      'zip': 'application/zip',
    }
    const contentType = contentTypeMap[ext || ''] || 'application/octet-stream'

    // 设置响应头
    setResponseHeaders(event, {
      'Content-Type': contentType,
      'Content-Length': stats.size.toString(),
      'Cache-Control': 'public, max-age=31536000', // 1 year
      'Last-Modified': stats.mtime.toUTCString(),
    })

    // 返回文件内容
    return fileBuffer
  } catch (error) {
    console.error('[File Proxy] Error serving file:', error)
    throw createError({
      statusCode: 500,
      message: 'Failed to serve file'
    })
  }
})
