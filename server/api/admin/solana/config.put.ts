import { prisma } from '~~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { network } = body

  if (!network || !['mainnet', 'devnet'].includes(network)) {
    throw createError({
      statusCode: 400,
      message: '无效的网络类型，仅支持 mainnet 或 devnet',
    })
  }

  // 更新或创建配置
  const config = await prisma.systemConfig.upsert({
    where: { configKey: 'solana_network' },
    update: {
      configValue: network,
      updatedAt: new Date(),
    },
    create: {
      configKey: 'solana_network',
      configValue: network,
      description: 'Solana 网络环境配置',
    },
  })

  return {
    code: 0,
    data: {
      network: config.configValue,
    },
    message: `已切换到 ${network === 'mainnet' ? '主网' : '测试网'}`,
  }
})
