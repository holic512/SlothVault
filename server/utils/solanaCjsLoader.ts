/**
 * Solana CJS 加载器
 *
 * 目的：使用绝对路径 + createRequire 加载 CJS 隔离模块
 * 避免 Nitro 重排目录导致的路径失效
 */

import { createRequire } from 'module'
import { join } from 'path'

// 创建 require 函数
const require = createRequire(import.meta.url)

/**
 * 加载 Solana CJS 模块
 *
 * 在开发环境和生产环境使用不同的路径：
 * - 开发环境：直接从 server/utils/solana.cjs 加载
 * - 生产环境：从 .output/server/utils/solana.cjs 加载（由 postbuild 复制）
 */
export function loadSolanaCjs() {
  const isDev = process.env.NODE_ENV !== 'production'

  let modulePath: string

  if (isDev) {
    // 开发环境：使用项目根目录的 server/utils/solana.cjs
    modulePath = join(process.cwd(), 'server/utils/solana.cjs')
  } else {
    // 生产环境：使用 .output/server/utils/solana.cjs
    // process.cwd() 在生产环境指向项目根目录
    modulePath = join(process.cwd(), '.output/server/utils/solana.cjs')
  }

  try {
    return require(modulePath)
  } catch (error) {
    console.error(`❌ 加载 Solana CJS 模块失败: ${modulePath}`)
    console.error('错误详情:', error)
    throw new Error(`无法加载 Solana CJS 模块: ${error.message}`)
  }
}

/**
 * 获取 Solana CJS 模块的单例实例
 */
let solanaCjsInstance: any = null

export function getSolanaCjs() {
  if (!solanaCjsInstance) {
    solanaCjsInstance = loadSolanaCjs()
  }
  return solanaCjsInstance
}
