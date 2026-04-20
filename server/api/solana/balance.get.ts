import { getSolanaCjs } from '~~/server/utils/solanaCjsLoader'
import { createError, defineEventHandler, getQuery } from 'h3'
import { getRpcUrl } from '~~/server/utils/solana'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const address = query.address as string

  if (!address) {
    throw createError({
      statusCode: 400,
      message: '缺少钱包地址参数',
    })
  }

  // 加载 Solana CJS 模块
  const solanaCjs = getSolanaCjs()

  // 验证地址格式
  if (!solanaCjs.isValidSolanaAddress(address)) {
    throw createError({
      statusCode: 400,
      message: '无效的钱包地址',
    })
  }

  // 从数据库配置获取 RPC URL
  const rpcUrl = await getRpcUrl('mainnet')
  if (!rpcUrl) {
    throw createError({
      statusCode: 500,
      message: '未配置 Solana RPC URL，请在系统设置中配置',
    })
  }

  try {
    const connection = solanaCjs.createConnection(rpcUrl, {
      commitment: 'confirmed',
    })

    const balance = await solanaCjs.getBalance(connection, address)

    return {
      code: 0,
      data: {
        address,
        balance, // lamports
        sol: solanaCjs.lamportsToSol(balance),
      },
    }
  } catch (err: any) {
    console.error('获取余额失败:', err.message)
    throw createError({
      statusCode: 503,
      message: `获取余额失败: ${err.message}`,
    })
  }
})
