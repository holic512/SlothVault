/**
 * 批量更新系统配置
 * PUT /api/admin/mm/config
 *
 * Body: { configs: [{ key: string, value: string }] }
 */
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { setResponseStatus, readBody } from 'h3'
import { setConfigs, CONFIG_KEYS, type ConfigKey } from '~~/server/utils/configCache'
import { resetFilebaseClient } from '~~/server/utils/filebase'

// 有效的配置键集合
const validKeys = new Set(Object.values(CONFIG_KEYS))

export default defineEventHandler(async (event) => {
  // 验证登录
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  try {
    const body = await readBody(event)

    if (!body?.configs || !Array.isArray(body.configs)) {
      setResponseStatus(event, 400)
      return fail('请求参数错误：configs 必须是数组', 400)
    }

    // 验证并过滤配置
    const validConfigs: Array<{ key: ConfigKey; value: string }> = []

    for (const item of body.configs) {
      if (!item.key || typeof item.key !== 'string') {
        continue
      }

      if (!validKeys.has(item.key)) {
        continue // 忽略无效的配置键
      }

      validConfigs.push({
        key: item.key as ConfigKey,
        value: typeof item.value === 'string' ? item.value : '',
      })
    }

    if (validConfigs.length === 0) {
      setResponseStatus(event, 400)
      return fail('没有有效的配置项', 400)
    }

    // 保存配置
    await setConfigs(validConfigs)

    // 重置相关客户端（使其在下次使用时重新加载配置）
    resetFilebaseClient()

    return ok({
      updated: validConfigs.length,
      message: '配置已保存',
    })
  } catch (err: any) {
    console.error('[Config API] Failed to update configs:', err)
    setResponseStatus(event, 500)
    return fail('保存配置失败', 500)
  }
})
