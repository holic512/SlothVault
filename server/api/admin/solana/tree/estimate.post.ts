import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { calculateTreeSpace, getConnection, type SolanaNetwork } from '~~/server/utils/solana'
import { isRpcConnectionError } from '~~/server/utils/solanaErrors'

// Merkle Tree 配置预设
// 注意：Solana 账户最大约 10MB，超大型树需要合理配置 canopyDepth
const TREE_PRESETS = [
  { label: '小型 (1K)', maxDepth: 10, maxBufferSize: 8, canopyDepth: 0 },
  { label: '中型 (16K)', maxDepth: 14, maxBufferSize: 64, canopyDepth: 0 },
  { label: '大型 (1M)', maxDepth: 20, maxBufferSize: 256, canopyDepth: 10 },
  { label: '超大型 (1B)', maxDepth: 30, maxBufferSize: 512, canopyDepth: 0 }, // canopyDepth=0 避免账户过大
]

/**
 * 根据账户大小估算租金（离线计算，不依赖 RPC）
 * Solana 租金计算公式：(spaceBytes + 128) * 6960 lamports/byte
 * 注意：使用 BigInt 避免大数值精度问题
 */
function estimateRentOffline(spaceBytes: number): number {
  const RENT_PER_BYTE = 6960n
  const space = BigInt(spaceBytes)
  const rent = (space + 128n) * RENT_PER_BYTE
  return Number(rent)
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { maxDepth, maxBufferSize, canopyDepth, network = 'devnet' } = body
  const networkType = network as SolanaNetwork

  // 如果提供了具体参数，计算单个预估
  if (maxDepth !== undefined && maxBufferSize !== undefined) {
    const depth = Number(maxDepth)
    const bufferSize = Number(maxBufferSize)
    const canopy = Number(canopyDepth || 0)
    
    const space = calculateTreeSpace(depth, bufferSize, canopy)
    const capacity = Math.pow(2, depth)
    
    // 离线估算租金
    let rentLamports = estimateRentOffline(space)
    let isEstimate = true

    // 尝试从链上获取精确租金（静默失败）
    try {
      const connection = getConnection(networkType)
      rentLamports = await connection.getMinimumBalanceForRentExemption(space)
      isEstimate = false
    } catch {
      // 静默使用估算值
    }

    // 根据租金大小动态调整小数位数
    const rentSol = rentLamports / LAMPORTS_PER_SOL
    const rentSolStr = rentSol >= 100 ? rentSol.toFixed(2) : rentSol >= 1 ? rentSol.toFixed(3) : rentSol.toFixed(4)

    return {
      code: 0,
      data: {
        maxDepth: depth,
        maxBufferSize: bufferSize,
        canopyDepth: canopy,
        capacity,
        spaceBytes: space,
        rentLamports,
        rentSol: rentSolStr,
        network: networkType,
        isEstimate,
      },
    }
  }

  // 返回所有预设的预估
  // 尝试获取链上租金，失败则使用离线估算
  let isEstimate = true
  let connection = null
  
  try {
    connection = getConnection(networkType)
    // 测试连接是否可用
    await connection.getLatestBlockhash()
    isEstimate = false
  } catch (err: any) {
    // 静默处理，使用离线估算（不打印警告，因为这是正常的降级行为）
    connection = null
  }

  const estimates = await Promise.all(
    TREE_PRESETS.map(async (preset) => {
      try {
        const space = calculateTreeSpace(preset.maxDepth, preset.maxBufferSize, preset.canopyDepth)
        const capacity = Math.pow(2, preset.maxDepth)
        
        let rentLamports: number
        if (connection && !isEstimate) {
          try {
            rentLamports = await connection.getMinimumBalanceForRentExemption(space)
          } catch {
            rentLamports = estimateRentOffline(space)
          }
        } else {
          rentLamports = estimateRentOffline(space)
        }
        
        // 根据租金大小动态调整小数位数
        const rentSol = rentLamports / LAMPORTS_PER_SOL
        const rentSolStr = rentSol >= 100 ? rentSol.toFixed(2) : rentSol >= 1 ? rentSol.toFixed(3) : rentSol.toFixed(4)
        
        return {
          label: preset.label,
          maxDepth: preset.maxDepth,
          maxBufferSize: preset.maxBufferSize,
          canopyDepth: preset.canopyDepth,
          capacity,
          spaceBytes: space,
          rentLamports,
          rentSol: rentSolStr,
        }
      } catch (err) {
        console.error(`计算预设 ${preset.label} 失败:`, err)
        // 返回一个带有错误标记的预设
        return {
          label: preset.label,
          maxDepth: preset.maxDepth,
          maxBufferSize: preset.maxBufferSize,
          canopyDepth: preset.canopyDepth,
          capacity: Math.pow(2, preset.maxDepth),
          spaceBytes: 0,
          rentLamports: 0,
          rentSol: '计算失败',
        }
      }
    })
  )

  return {
    code: 0,
    data: {
      presets: estimates,
      network: networkType,
      isEstimate,
    },
  }
})
