/**
 * 获取所有系统配置
 * GET /api/admin/mm/config
 */
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { setResponseStatus } from 'h3'
import { getAllConfigs, CONFIG_GROUPS } from '~~/server/utils/configCache'

export default defineEventHandler(async (event) => {
  // 验证登录
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  try {
    const configs = await getAllConfigs()

    // 按分组组织配置
    const groups = Object.entries(CONFIG_GROUPS).map(([groupKey, group]) => ({
      key: groupKey,
      label: group.label,
      configs: configs.filter((c) => group.keys.includes(c.key as any)),
    }))

    return ok({
      configs,
      groups,
    })
  } catch (err: any) {
    console.error('[Config API] Failed to get configs:', err)
    setResponseStatus(event, 500)
    return fail('获取配置失败', 500)
  }
})
