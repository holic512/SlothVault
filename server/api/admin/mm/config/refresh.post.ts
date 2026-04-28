/**
 * 刷新配置缓存
 * POST /api/admin/mm/config/refresh
 *
 * 清除内存缓存，强制从数据库重新加载配置
 */
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { setResponseStatus } from 'h3'
import { refreshCache, warmupCache } from '~~/server/utils/configCache'
import { resetFilebaseClient } from '~~/server/utils/filebase'

export default defineEventHandler(async (event) => {
  // 验证登录
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  try {
    // 清除配置缓存
    refreshCache()

    // 重置 Filebase 客户端
    resetFilebaseClient()

    // 预热缓存（重新从数据库加载）
    await warmupCache()

    return ok({
      message: '缓存已刷新',
      timestamp: new Date().toISOString(),
    })
  } catch (err: any) {
    console.error('[Config API] Failed to refresh cache:', err)
    setResponseStatus(event, 500)
    return fail('刷新缓存失败', 500)
  }
})
