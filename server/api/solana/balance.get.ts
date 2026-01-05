import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const address = query.address as string

  if (!address) {
    throw createError({
      statusCode: 400,
      message: '缺少钱包地址参数',
    })
  }

  // 验证地址格式
  let pubKey: PublicKey
  try {
    pubKey = new PublicKey(address)
  } catch {
    throw createError({
      statusCode: 400,
      message: '无效的钱包地址',
    })
  }

  // 从环境变量获取 RPC URL
  const rpcUrl = process.env.SOLANA_RPC_URL
  if (!rpcUrl) {
    throw createError({
      statusCode: 500,
      message: '未配置 SOLANA_RPC_URL 环境变量，请在 .env 中添加',
    })
  }

  try {
    const connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
    })
    
    const balance = await connection.getBalance(pubKey)
    
    return {
      code: 0,
      data: {
        address,
        balance, // lamports
        sol: balance / LAMPORTS_PER_SOL,
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
