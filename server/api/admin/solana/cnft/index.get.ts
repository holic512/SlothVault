/**
 * 获取 cNFT 列表
 * 支持按项目、树、持有者、状态、网络筛选
 * 包含项目名称和树名称的关联查询
 */

import { prisma } from '~~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const {
    projectId,
    merkleTreeId,
    ownerAddress,
    status,
    network,
    page = '1',
    pageSize = '20',
  } = query

  // 构建查询条件
  const where: any = {}

  if (projectId) {
    where.projectId = BigInt(projectId as string)
  }

  if (merkleTreeId) {
    where.merkleTreeId = BigInt(merkleTreeId as string)
  }

  if (ownerAddress) {
    where.ownerAddress = {
      contains: ownerAddress as string,
    }
  }

  if (status !== undefined && status !== '') {
    where.status = Number(status)
  }

  // 按网络筛选（通过关联的 merkleTree）
  if (network) {
    where.merkleTree = {
      network: network as string,
    }
  }

  // 分页参数验证
  const pageNum = Math.max(1, Number(page) || 1)
  const pageSizeNum = Math.min(100, Math.max(1, Number(pageSize) || 20))
  const skip = (pageNum - 1) * pageSizeNum
  const take = pageSizeNum

  // 并行查询 cNFT 列表和总数
  const [cnfts, total] = await Promise.all([
    prisma.compressedNft.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        merkleTree: {
          select: {
            name: true,
            treeAddress: true,
            network: true,
          },
        },
      },
    }),
    prisma.compressedNft.count({ where }),
  ])

  // 收集所有 projectId 并批量查询项目信息
  const projectIds = [...new Set(cnfts.map((cnft) => cnft.projectId))]
  const projects = projectIds.length > 0
    ? await prisma.project.findMany({
        where: {
          id: { in: projectIds },
        },
        select: {
          id: true,
          projectName: true,
          avatar: true,
        },
      })
    : []

  // 构建 projectId -> project 映射
  const projectMap = new Map(
    projects.map((p) => [p.id.toString(), p])
  )

  return {
    code: 0,
    data: {
      list: cnfts.map((cnft) => {
        const project = projectMap.get(cnft.projectId.toString())
        return {
          id: cnft.id.toString(),
          projectId: cnft.projectId.toString(),
          projectName: project?.projectName || null,
          projectAvatar: project?.avatar || null,
          assetId: cnft.assetId,
          leafIndex: cnft.leafIndex,
          name: cnft.name,
          symbol: cnft.symbol,
          metadataUri: cnft.metadataUri,
          ownerAddress: cnft.ownerAddress,
          mintTxSignature: cnft.mintTxSignature,
          status: cnft.status,
          createdAt: cnft.createdAt,
          updatedAt: cnft.updatedAt,
          merkleTree: {
            name: cnft.merkleTree.name,
            treeAddress: cnft.merkleTree.treeAddress,
            network: cnft.merkleTree.network,
          },
        }
      }),
      total,
      page: pageNum,
      pageSize: pageSizeNum,
    },
  }
})
