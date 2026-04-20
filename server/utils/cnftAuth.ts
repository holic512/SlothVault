/**
 * cNFT 鉴权工具模块
 *
 * 提供基于 cNFT 持有的项目访问权限验证
 * 采用本地数据库优先 + 链上验证兜底的高性能方案
 *
 * 验证流程：
 * 1. 查询本地数据库 CompressedNft 表
 * 2. 如果本地有记录且 ownerAddress 匹配 → 通过
 * 3. 如果本地无记录或不匹配 → 调用 DAS API 验证链上状态
 * 4. 链上验证通过后，更新本地数据库
 */

import { prisma } from './prisma'
import { createError } from 'h3'
import { getSolanaRpcUrl, getSolanaDevnetRpcUrl } from './configCache'
import { isValidSolanaAddress } from './solana'

/**
 * 验证结果
 */
export interface AuthResult {
  /** 是否有访问权限 */
  hasAccess: boolean
  /** 原因说明 */
  reason: string
  /** 匹配的 cNFT asset ID（如果有） */
  assetId?: string
}

/**
 * DAS API 返回的资产结构（简化）
 */
interface DasAsset {
  id: string
  compression?: {
    compressed: boolean
    tree?: string
    leaf_index?: number
  }
  ownership?: {
    owner: string
  }
  grouping?: Array<{
    group_key: string
    group_value: string
  }>
}

/**
 * 获取 DAS API RPC URL
 * 优先使用配置的 RPC URL（如 Helius），支持 DAS API
 */
async function getDasRpcUrl(network: 'mainnet' | 'devnet' = 'devnet'): Promise<string> {
  if (network === 'mainnet') {
    const url = await getSolanaRpcUrl()
    if (url) return url
    // 回退到公共 RPC（注意：公共 RPC 可能不支持 DAS API）
    return 'https://api.mainnet-beta.solana.com'
  }
  const url = await getSolanaDevnetRpcUrl()
  if (url) return url
  return 'https://api.devnet.solana.com'
}

/**
 * 调用 DAS API 获取用户持有的所有 cNFT
 *
 * @param ownerAddress - 钱包地址
 * @param network - 网络类型
 * @returns 资产列表
 */
async function fetchAssetsByOwner(
  ownerAddress: string,
  network: 'mainnet' | 'devnet' = 'devnet'
): Promise<DasAsset[]> {
  const rpcUrl = await getDasRpcUrl(network)

  const allAssets: DasAsset[] = []
  let page = 1
  const limit = 1000

  // 分页获取所有资产
  while (true) {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `getAssetsByOwner-${page}`,
        method: 'getAssetsByOwner',
        params: {
          ownerAddress,
          page,
          limit,
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`DAS API request failed: ${response.status}`)
    }

    const data = await response.json()

    if (data.error) {
      throw new Error(`DAS API error: ${data.error.message || JSON.stringify(data.error)}`)
    }

    const items = data.result?.items || []
    allAssets.push(...items)

    // 如果返回数量小于 limit，说明已经是最后一页
    if (items.length < limit) {
      break
    }

    page++

    // 安全限制：最多获取 10 页
    if (page > 10) {
      console.warn('[cnftAuth] Reached max page limit (10)')
      break
    }
  }

  return allAssets
}

/**
 * 从本地数据库验证 cNFT 持有
 *
 * @param projectId - 项目 ID
 * @param walletAddress - 钱包地址
 * @returns 验证结果
 */
async function verifyFromDatabase(
  projectId: bigint,
  walletAddress: string
): Promise<AuthResult | null> {
  // 查询该项目下该钱包持有的 cNFT
  const cnft = await prisma.compressedNft.findFirst({
    where: {
      projectId,
      ownerAddress: walletAddress,
      status: 1, // 正常状态
    },
    select: {
      assetId: true,
    },
  })

  if (cnft) {
    return {
      hasAccess: true,
      reason: '本地验证通过',
      assetId: cnft.assetId,
    }
  }

  return null
}

/**
 * 从链上验证 cNFT 持有并更新本地数据库
 *
 * @param projectId - 项目 ID
 * @param walletAddress - 钱包地址
 * @param network - 网络类型
 * @returns 验证结果
 */
async function verifyFromChain(
  projectId: bigint,
  walletAddress: string,
  network: 'mainnet' | 'devnet' = 'devnet'
): Promise<AuthResult> {
  try {
    // 1. 获取该项目关联的所有 cNFT asset IDs
    const projectCnfts = await prisma.compressedNft.findMany({
      where: {
        projectId,
        status: 1,
      },
      select: {
        id: true,
        assetId: true,
        ownerAddress: true,
      },
    })

    if (projectCnfts.length === 0) {
      return {
        hasAccess: false,
        reason: '该项目暂无可用的访问凭证',
      }
    }

    const projectAssetIds = new Set(projectCnfts.map(c => c.assetId))

    // 2. 获取用户链上持有的所有资产
    const userAssets = await fetchAssetsByOwner(walletAddress, network)

    // 3. 检查用户是否持有该项目的任一 cNFT
    for (const asset of userAssets) {
      if (projectAssetIds.has(asset.id)) {
        // 找到匹配的 cNFT，更新本地数据库的 ownerAddress
        const matchedCnft = projectCnfts.find(c => c.assetId === asset.id)
        if (matchedCnft && matchedCnft.ownerAddress !== walletAddress) {
          // 更新所有者地址
          await prisma.compressedNft.update({
            where: { id: matchedCnft.id },
            data: {
              ownerAddress: walletAddress,
              updatedAt: new Date(),
            },
          })
          console.log(`[cnftAuth] Updated owner for asset ${asset.id}: ${matchedCnft.ownerAddress} -> ${walletAddress}`)
        }

        return {
          hasAccess: true,
          reason: '链上验证通过',
          assetId: asset.id,
        }
      }
    }

    return {
      hasAccess: false,
      reason: '未持有该项目的访问凭证',
    }
  } catch (error: any) {
    console.error('[cnftAuth] Chain verification failed:', error)
    return {
      hasAccess: false,
      reason: `链上验证失败: ${error.message || '未知错误'}`,
    }
  }
}

/**
 * 验证用户是否有权访问项目
 *
 * 高性能验证流程：
 * 1. 检查项目是否需要鉴权
 * 2. 如果不需要鉴权，直接返回有权限
 * 3. 如果需要鉴权但未提供钱包地址，返回无权限
 * 4. 优先从本地数据库验证
 * 5. 本地验证失败则从链上验证
 *
 * @param projectId - 项目 ID
 * @param walletAddress - 钱包地址（可选）
 * @param options - 验证选项
 * @returns 验证结果
 */
export async function verifyProjectAccess(
  projectId: bigint,
  walletAddress?: string | null,
  options: {
    /** 是否跳过链上验证（仅使用本地数据库） */
    skipChainVerify?: boolean
    /** 网络类型 */
    network?: 'mainnet' | 'devnet'
  } = {}
): Promise<AuthResult> {
  const { skipChainVerify = false, network = 'devnet' } = options

  // 1. 查询项目信息
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      isDeleted: false,
      status: 1,
    },
    select: {
      requireAuth: true,
      projectName: true,
    },
  })

  if (!project) {
    return {
      hasAccess: false,
      reason: '项目不存在',
    }
  }

  // 2. 如果项目不需要鉴权，直接返回有权限
  if (!project.requireAuth) {
    return {
      hasAccess: true,
      reason: '项目无需鉴权',
    }
  }

  // 3. 需要鉴权但未提供钱包地址
  if (!walletAddress) {
    return {
      hasAccess: false,
      reason: '请连接钱包以验证访问权限',
    }
  }

  // 4. 验证钱包地址格式
  if (!isValidSolanaAddress(walletAddress)) {
    return {
      hasAccess: false,
      reason: '无效的钱包地址',
    }
  }

  // 5. 优先从本地数据库验证
  const dbResult = await verifyFromDatabase(projectId, walletAddress)
  if (dbResult) {
    return dbResult
  }

  // 6. 本地验证失败，从链上验证
  if (!skipChainVerify) {
    return verifyFromChain(projectId, walletAddress, network)
  }

  return {
    hasAccess: false,
    reason: '未持有该项目的访问凭证',
  }
}

/**
 * 批量检查项目访问权限（用于项目列表）
 *
 * @param projectIds - 项目 ID 列表
 * @param walletAddress - 钱包地址
 * @returns 项目 ID 到访问权限的映射
 */
export async function batchVerifyProjectAccess(
  projectIds: bigint[],
  walletAddress?: string | null
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>()

  if (!walletAddress || !isValidSolanaAddress(walletAddress)) {
    // 无钱包地址时，查询哪些项目需要鉴权
    const projects = await prisma.project.findMany({
      where: {
        id: { in: projectIds },
        isDeleted: false,
        status: 1,
      },
      select: {
        id: true,
        requireAuth: true,
      },
    })

    for (const project of projects) {
      // 不需要鉴权的项目有权限，需要鉴权的无权限
      result.set(project.id.toString(), !project.requireAuth)
    }

    return result
  }

  // 有钱包地址时，查询用户持有的 cNFT
  const userCnfts = await prisma.compressedNft.findMany({
    where: {
      projectId: { in: projectIds },
      ownerAddress: walletAddress,
      status: 1,
    },
    select: {
      projectId: true,
    },
  })

  const userProjectIds = new Set(userCnfts.map(c => c.projectId.toString()))

  // 查询项目信息
  const projects = await prisma.project.findMany({
    where: {
      id: { in: projectIds },
      isDeleted: false,
      status: 1,
    },
    select: {
      id: true,
      requireAuth: true,
    },
  })

  for (const project of projects) {
    const projectIdStr = project.id.toString()
    if (!project.requireAuth) {
      // 不需要鉴权
      result.set(projectIdStr, true)
    } else {
      // 需要鉴权，检查是否持有 cNFT
      result.set(projectIdStr, userProjectIds.has(projectIdStr))
    }
  }

  return result
}

/**
 * 创建鉴权失败的 HTTP 错误
 */
export function createAuthError(reason: string) {
  return createError({
    statusCode: 403,
    message: reason,
    data: {
      code: 'AUTH_REQUIRED',
      reason,
    },
  })
}
