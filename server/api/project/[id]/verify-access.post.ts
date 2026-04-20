/**
 * 验证项目访问权限 API
 *
 * POST /api/project/:id/verify-access
 *
 * 用于前端主动验证用户是否有权访问某个项目
 * 支持链上验证和本地缓存验证
 */

import { verifyProjectAccess } from '~~/server/utils/cnftAuth'
import { isValidSolanaAddress } from '~~/server/utils/solana'
import { ok, fail } from '~~/server/utils/response'
import { prisma } from '~~/server/utils/prisma'
import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'

interface VerifyAccessRequest {
  /** 钱包地址 */
  walletAddress?: string
  /** 是否强制链上验证（跳过本地缓存） */
  forceChainVerify?: boolean
}

interface VerifyAccessResponse {
  /** 是否有访问权限 */
  hasAccess: boolean
  /** 原因说明 */
  reason: string
  /** 匹配的 cNFT asset ID（如果有） */
  assetId?: string
  /** 项目是否需要鉴权 */
  requireAuth: boolean
}

export default defineEventHandler(async (event) => {
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

  // 读取请求体
  let body: VerifyAccessRequest = {}
  try {
    body = await readBody(event) || {}
  } catch {
    // 允许空请求体
  }

  const { walletAddress, forceChainVerify = false } = body

  // 验证钱包地址格式（如果提供）
  if (walletAddress && !isValidSolanaAddress(walletAddress)) {
    setResponseStatus(event, 400)
    return fail('Invalid wallet address', 400)
  }

  try {
    // 先查询项目是否需要鉴权
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

    if (!project) {
      setResponseStatus(event, 404)
      return fail('Project not found', 404)
    }

    // 执行验证
    const result = await verifyProjectAccess(projectId, walletAddress, {
      skipChainVerify: !forceChainVerify && !walletAddress,
      network: 'devnet', // TODO: 从配置读取
    })

    const response: VerifyAccessResponse = {
      hasAccess: result.hasAccess,
      reason: result.reason,
      assetId: result.assetId,
      requireAuth: project.requireAuth,
    }

    return ok(response)
  } catch (err: any) {
    console.error('[verify-access] Error:', err)
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
