import { createError, defineEventHandler, readBody } from 'h3'
import { CONFIG_KEYS, setConfig } from '~~/server/utils/configCache'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { network } = body

  if (!network || !['mainnet', 'devnet'].includes(network)) {
    throw createError({
      statusCode: 400,
      message: '无效的网络类型，仅支持 mainnet 或 devnet',
    })
  }

  await setConfig(CONFIG_KEYS.SOLANA_NETWORK, network)

  return {
    code: 0,
    data: {
      network,
    },
    message: `已切换到 ${network === 'mainnet' ? '主网' : '测试网'}`,
  }
})
