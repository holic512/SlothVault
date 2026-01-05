import { prisma } from '~~/server/utils/prisma'

export default defineEventHandler(async () => {
  // 获取 Solana 网络配置
  const config = await prisma.systemConfig.findUnique({
    where: { configKey: 'solana_network' },
  })

  return {
    code: 0,
    data: {
      network: config?.configValue || 'devnet',
    },
  }
})
