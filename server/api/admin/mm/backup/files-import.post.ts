import { readSession } from '~~/server/utils/session'
import { ok, fail } from '~~/server/utils/response'
import { setResponseStatus, readMultipartFormData } from 'h3'
import { createWriteStream, mkdirSync, existsSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import unzipper from 'unzipper'

export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  try {
    const formData = await readMultipartFormData(event)
    if (!formData || formData.length === 0) {
      setResponseStatus(event, 400)
      return fail('No file uploaded', 400)
    }

    // 获取上传的 zip 文件和模式
    const zipFile = formData.find(item => item.name === 'file')
    const modeField = formData.find(item => item.name === 'mode')
    const mode = modeField?.data?.toString('utf-8') || 'insert' // 'insert' | 'overwrite'

    if (!zipFile || !zipFile.data) {
      setResponseStatus(event, 400)
      return fail('Invalid file upload', 400)
    }

    const uploadsDir = join(process.cwd(), 'public', 'uploads')

    // 如果是覆盖模式，先清空现有文件
    if (mode === 'overwrite') {
      if (existsSync(uploadsDir)) {
        // 删除所有子目录和文件
        const subdirs = readdirSync(uploadsDir)
        for (const subdir of subdirs) {
          const subdirPath = join(uploadsDir, subdir)
          rmSync(subdirPath, { recursive: true, force: true })
        }
      }
    }

    // 确保 uploads 目录存在
    if (!existsSync(uploadsDir)) {
      mkdirSync(uploadsDir, { recursive: true })
    }

    // 创建临时文件流
    const zipBuffer = zipFile.data
    const readable = Readable.from(zipBuffer)

    // 解压文件
    let fileCount = 0
    await readable.pipe(unzipper.Parse()).on('entry', async (entry) => {
      const fileName = entry.path
      const type = entry.type // 'Directory' or 'File'

      if (type === 'Directory') {
        const dirPath = join(uploadsDir, fileName)
        if (!existsSync(dirPath)) {
          mkdirSync(dirPath, { recursive: true })
        }
        entry.autodrain()
      } else {
        const filePath = join(uploadsDir, fileName)
        const fileDir = join(filePath, '..')

        // 确保父目录存在
        if (!existsSync(fileDir)) {
          mkdirSync(fileDir, { recursive: true })
        }

        // 写入文件
        await pipeline(entry, createWriteStream(filePath))
        fileCount++
      }
    }).promise()

    return ok({
      message: 'Files import completed successfully',
      mode,
      filesImported: fileCount,
    })
  } catch (err) {
    console.error('Files import error:', err)
    setResponseStatus(event, 500)
    return fail('Files import failed: ' + (err instanceof Error ? err.message : 'Unknown error'), 500)
  }
})
