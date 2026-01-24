import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { readBody, setResponseStatus } from 'h3'
import { existsSync, rmSync, readdirSync, mkdirSync } from 'fs'
import { join } from 'path'

export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  try {
    const body = await readBody(event)
    const { confirm, clearDatabase = true, clearFiles = true } = body

    // 安全确认机制
    if (confirm !== 'RESET_ALL_DATA') {
      setResponseStatus(event, 400)
      return fail('Invalid confirmation code. Please send { "confirm": "RESET_ALL_DATA" } to proceed.', 400)
    }

    const result: any = {
      database: null,
      files: null,
    }

    // 1. 清空数据库（保留 auth schema）
    if (clearDatabase) {
      try {
        // 按依赖顺序删除（从子表到父表）
        const dbResult = await prisma.$transaction([
          prisma.compressedNft.deleteMany({}),
          prisma.merkleTree.deleteMany({}),
          prisma.noteContent.deleteMany({}),
          prisma.noteInfo.deleteMany({}),
          prisma.category.deleteMany({}),
          prisma.projectVersion.deleteMany({}),
          prisma.projectMenu.deleteMany({}),
          prisma.projectHome.deleteMany({}),
          prisma.project.deleteMany({}),
          prisma.fileManagement.deleteMany({}),
          prisma.systemConfig.deleteMany({}),
          prisma.systemHomepage.deleteMany({}),
        ])

        result.database = {
          success: true,
          deleted: {
            compressedNfts: dbResult[0].count,
            merkleTrees: dbResult[1].count,
            noteContents: dbResult[2].count,
            noteInfos: dbResult[3].count,
            categories: dbResult[4].count,
            projectVersions: dbResult[5].count,
            projectMenus: dbResult[6].count,
            projectHomes: dbResult[7].count,
            projects: dbResult[8].count,
            fileManagements: dbResult[9].count,
            systemConfigs: dbResult[10].count,
            systemHomepages: dbResult[11].count,
          },
          totalDeleted: dbResult.reduce((sum, r) => sum + r.count, 0),
        }
      } catch (err) {
        console.error('Database reset error:', err)
        result.database = {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        }
      }
    }

    // 2. 清空文件系统
    if (clearFiles) {
      try {
        // 使用环境变量判断是否为生产环境（Docker 部署）
        const isProduction = process.env.NODE_ENV === 'production'
        const publicDir = isProduction
          ? join(process.cwd(), '.output', 'public')
          : join(process.cwd(), 'public')
        const uploadsDir = join(publicDir, 'uploads')
        let filesDeleted = 0
        let dirsDeleted = 0

        if (existsSync(uploadsDir)) {
          // 删除所有子目录和文件
          const subdirs = readdirSync(uploadsDir)
          for (const subdir of subdirs) {
            const subdirPath = join(uploadsDir, subdir)
            try {
              // 统计文件数量
              const countFiles = (dir: string): number => {
                let count = 0
                const items = readdirSync(dir, { withFileTypes: true })
                for (const item of items) {
                  if (item.isDirectory()) {
                    count += countFiles(join(dir, item.name))
                  } else {
                    count++
                  }
                }
                return count
              }

              filesDeleted += countFiles(subdirPath)
              rmSync(subdirPath, { recursive: true, force: true })
              dirsDeleted++
            } catch (err) {
              console.error(`Failed to delete ${subdirPath}:`, err)
            }
          }

          // 重新创建标准目录结构
          const standardDirs = ['avatar', 'markdown', 'other', 'project-avatar']
          for (const dir of standardDirs) {
            const dirPath = join(uploadsDir, dir)
            if (!existsSync(dirPath)) {
              mkdirSync(dirPath, { recursive: true })
            }
          }
        }

        result.files = {
          success: true,
          filesDeleted,
          dirsDeleted,
          standardDirsRecreated: ['avatar', 'markdown', 'other', 'project-avatar'],
        }
      } catch (err) {
        console.error('Files reset error:', err)
        result.files = {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        }
      }
    }

    // 检查是否有任何操作失败
    const hasError =
      (clearDatabase && !result.database?.success) ||
      (clearFiles && !result.files?.success)

    if (hasError) {
      setResponseStatus(event, 500)
      return fail('System reset partially failed', 500, result)
    }

    return ok({
      message: 'System reset completed successfully',
      ...result,
    })
  } catch (err) {
    console.error('System reset error:', err)
    setResponseStatus(event, 500)
    return fail('System reset failed: ' + (err instanceof Error ? err.message : 'Unknown error'), 500)
  }
})
