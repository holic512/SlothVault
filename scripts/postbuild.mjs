#!/usr/bin/env node

/**
 * Postbuild 脚本
 *
 * 目的：构建后手动复制 CJS 隔离文件到 .output/server
 * 这是唯一可靠的方式确保 CJS 文件在运行时可用
 */

import { copyFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')

console.log('🔧 [Postbuild] 开始复制 CJS 隔离文件...')

// 源文件
const sourceFile = join(projectRoot, 'server/utils/solana.cjs')

// 目标目录和文件
const targetDir = join(projectRoot, '.output/server/utils')
const targetFile = join(targetDir, 'solana.cjs')

try {
  // 确保目标目录存在
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true })
    console.log(`✅ [Postbuild] 创建目录: ${targetDir}`)
  }

  // 复制文件
  copyFileSync(sourceFile, targetFile)
  console.log(`✅ [Postbuild] 复制成功: ${sourceFile} -> ${targetFile}`)

  console.log('🎉 [Postbuild] CJS 隔离文件复制完成！')
} catch (error) {
  console.error('❌ [Postbuild] 复制失败:', error.message)
  process.exit(1)
}
