/**
 * Solana CJS 加载器
 *
 * 在 Next.js 环境下使用静态相对路径加载本地 `.cjs` 文件，
 * 让 webpack/trace 能正确跟踪该依赖并将其带入 standalone 产物。
 */

import { createRequire } from 'module'

const require = createRequire(import.meta.url)

let solanaCjsInstance: any = null

export function loadSolanaCjs() {
  try {
    return require('./solana.cjs')
  } catch (error) {
    console.error('❌ 加载 Solana CJS 模块失败: ./solana.cjs')
    console.error('错误详情:', error)
    throw new Error(`无法加载 Solana CJS 模块: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function getSolanaCjs() {
  if (!solanaCjsInstance) {
    solanaCjsInstance = loadSolanaCjs()
  }
  return solanaCjsInstance
}
