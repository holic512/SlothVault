/**
 * 项目鉴权中间件工具
 *
 * 提供统一的项目访问权限验证逻辑
 * 用于需要鉴权的项目 API
 */

import { H3Event, getQuery, getRouterParam, setResponseStatus } from 'h3'
import { verifyProjectAccess, createAuthError } from './cnftAuth'
import { prisma } from './prisma'
import { fail } from './response'
import { getActiveNetwork } from './solana'

/**
 * 从请求中提取钱包地址
 * 支持 query 参数和 header
 */
export function getWalletAddress(event: H3Event): string | null {
  // 优先从 query 参数获取
  const query = getQuery(event)
  if (query.walletAddress && typeof query.walletAddress === 'string') {
    return query.walletAddress
  }

  // 其次从 header 获取
  const headerWallet = event.node.req.headers['x-wallet-address']
  if (headerWallet && typeof headerWallet === 'string') {
    return headerWallet
  }

  return null
}

/**
 * 验证项目访问权限
 *
 * @param event - H3 事件
 * @param projectId - 项目 ID
 * @returns 验证结果，如果无权限则抛出错误
 */
export async function requireProjectAccess(
  event: H3Event,
  projectId: bigint
): Promise<{ hasAccess: true; walletAddress: string | null }> {
  const walletAddress = getWalletAddress(event)
  const network = await getActiveNetwork()

  const result = await verifyProjectAccess(projectId, walletAddress, {
    skipChainVerify: false,
    network,
  })

  if (!result.hasAccess) {
    throw createAuthError(result.reason)
  }

  return {
    hasAccess: true,
    walletAddress,
  }
}

/**
 * 检查项目是否需要鉴权
 *
 * @param projectId - 项目 ID
 * @returns 是否需要鉴权
 */
export async function checkProjectRequireAuth(projectId: bigint): Promise<boolean> {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      isDeleted: false,
      status: 1,
    },
    select: {
      requireAuth: true,
    },
  })

  return project?.requireAuth ?? false
}

/**
 * 项目鉴权包装器
 *
 * 用于包装现有的 API handler，添加鉴权逻辑
 *
 * @param handler - 原始 handler
 * @returns 包装后的 handler
 */
export function withProjectAuth<T>(
  handler: (event: H3Event, projectId: bigint, walletAddress: string | null) => Promise<T>
) {
  return async (event: H3Event) => {
    const idRaw = getRouterParam(event, 'id')

    if (!idRaw) {
      setResponseStatus(event, 400)
      return fail('Missing project id', 400)
    }

    let projectId: bigint
    try {
      projectId = BigInt(idRaw)
    } catch {
      setResponseStatus(event, 400)
      return fail('Invalid project id', 400)
    }

    // 验证访问权限
    const walletAddress = getWalletAddress(event)
    const network = await getActiveNetwork()
    const result = await verifyProjectAccess(projectId, walletAddress, {
      skipChainVerify: false,
      network,
    })

    if (!result.hasAccess) {
      setResponseStatus(event, 403)
      return fail(result.reason, 403)
    }

    // 调用原始 handler
    return handler(event, projectId, walletAddress)
  }
}
