/**
 * Buffer Polyfill for Browser
 * 
 * @solana/web3.js 依赖 Node.js 的 buffer 模块
 * 此插件在客户端环境中提供 Buffer 全局变量
 */
import { Buffer } from 'buffer'

export default defineNuxtPlugin(() => {
  // 将 Buffer 挂载到全局
  if (typeof window !== 'undefined') {
    window.Buffer = Buffer
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.Buffer = Buffer
  }
})
