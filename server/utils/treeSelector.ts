import { prisma } from './prisma'

/**
 * 可用树信息接口
 */
export interface AvailableTree {
  id: bigint
  name: string
  treeAddress: string
  treeAuthority: string
  encryptedKey: string
  maxDepth: number
  maxBufferSize: number
  canopyDepth: number
  network: string
  totalMinted: number
  maxCapacity: bigint
  priority: number
  status: number
}

/**
 * 树状态枚举
 */
export const TreeStatus = {
  CREATING: 0,    // 创建中
  NORMAL: 1,      // 正常
  FULL: 2,        // 已满
  FAILED: -1,     // 失败
} as const

/**
 * 选择可用的 Merkle Tree
 * 
 * 选择逻辑：
 * 1. 筛选指定网络的树
 * 2. 筛选状态正常（status = 1）的树
 * 3. 筛选容量未满（totalMinted < maxCapacity）的树
 * 4. 筛选未删除的树
 * 5. 按优先级降序排序，返回优先级最高的树
 * 
 * @param network - 网络类型：'mainnet' | 'devnet'
 * @returns 选中的树信息，如果没有可用树则返回 null
 */
export async function selectAvailableTree(
  network: 'mainnet' | 'devnet' = 'devnet'
): Promise<AvailableTree | null> {
  // 查询可用的树
  // 注意：Prisma 不支持在 where 中直接比较两个字段，需要使用 $queryRaw 或在应用层过滤
  const trees = await prisma.merkleTree.findMany({
    where: {
      network,
      status: TreeStatus.NORMAL,
      isDeleted: false,
    },
    orderBy: [
      { priority: 'desc' },
      { createdAt: 'asc' }, // 同优先级时，优先使用较早创建的树
    ],
    select: {
      id: true,
      name: true,
      treeAddress: true,
      treeAuthority: true,
      encryptedKey: true,
      maxDepth: true,
      maxBufferSize: true,
      canopyDepth: true,
      network: true,
      totalMinted: true,
      maxCapacity: true,
      priority: true,
      status: true,
    },
  })

  // 在应用层过滤容量未满的树
  for (const tree of trees) {
    if (tree.totalMinted < Number(tree.maxCapacity)) {
      return tree
    }
    
    // 如果树已满，自动更新状态为已满
    await markTreeAsFull(tree.id)
  }

  return null
}

/**
 * 将树标记为已满状态
 * 
 * @param treeId - 树 ID
 */
export async function markTreeAsFull(treeId: bigint): Promise<void> {
  await prisma.merkleTree.update({
    where: { id: treeId },
    data: {
      status: TreeStatus.FULL,
      updatedAt: new Date(),
    },
  })
}

/**
 * 检查树是否有可用容量
 * 
 * @param treeId - 树 ID
 * @returns 是否有可用容量
 */
export async function hasAvailableCapacity(treeId: bigint): Promise<boolean> {
  const tree = await prisma.merkleTree.findUnique({
    where: { id: treeId },
    select: {
      totalMinted: true,
      maxCapacity: true,
      status: true,
      isDeleted: true,
    },
  })

  if (!tree || tree.isDeleted || tree.status !== TreeStatus.NORMAL) {
    return false
  }

  return tree.totalMinted < Number(tree.maxCapacity)
}

/**
 * 获取树的剩余容量
 * 
 * @param treeId - 树 ID
 * @returns 剩余容量，如果树不存在则返回 0
 */
export async function getRemainingCapacity(treeId: bigint): Promise<number> {
  const tree = await prisma.merkleTree.findUnique({
    where: { id: treeId },
    select: {
      totalMinted: true,
      maxCapacity: true,
    },
  })

  if (!tree) {
    return 0
  }

  return Math.max(0, Number(tree.maxCapacity) - tree.totalMinted)
}
