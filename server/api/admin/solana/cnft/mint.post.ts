/**
 * 铸造 cNFT
 * 
 * 流程：
 * 1. 选择可用的 Merkle Tree（按优先级，容量未满）
 * 2. 解密树权限私钥
 * 3. 构建铸造交易（返回给前端签名）
 * 
 * 注意：实际铸造需要树权限签名，此 API 准备交易数据
 */

import { prisma } from '~~/server/utils/prisma'
import { decryptPrivateKey, stringToSecretKey } from '~~/server/utils/crypto'
import { getRpcUrl } from '~~/server/utils/solana'
import { Keypair, PublicKey } from '@solana/web3.js'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const {
    projectId,
    ownerAddress,
    name,
    symbol,
    metadataUri,
    network,
  } = body

  // 参数验证
  if (!projectId || !ownerAddress || !name) {
    throw createError({
      statusCode: 400,
      message: '缺少必要参数：projectId, ownerAddress, name',
    })
  }

  // 验证地址格式
  try {
    new PublicKey(ownerAddress)
  } catch {
    throw createError({
      statusCode: 400,
      message: '无效的 ownerAddress 格式',
    })
  }

  const targetNetwork = network || 'devnet'

  // 查找可用的 Merkle Tree（按优先级排序，状态正常，容量未满）
  const availableTree = await prisma.merkleTree.findFirst({
    where: {
      network: targetNetwork,
      status: 1, // 正常状态
      isDeleted: false,
    },
    orderBy: { priority: 'desc' },
  })

  if (!availableTree) {
    throw createError({
      statusCode: 400,
      message: `没有可用的 Merkle Tree（${targetNetwork}），请先创建`,
    })
  }

  // 检查容量
  const mintedCount = await prisma.compressedNft.count({
    where: { merkleTreeId: availableTree.id },
  })

  if (mintedCount >= Number(availableTree.maxCapacity)) {
    // 标记为已满，尝试下一个树
    await prisma.merkleTree.update({
      where: { id: availableTree.id },
      data: { status: 2 }, // 已满
    })

    throw createError({
      statusCode: 400,
      message: '当前树容量已满，请创建新的 Merkle Tree',
    })
  }

  // 解密树权限私钥
  let treeAuthorityKeypair: Keypair | null = null
  if (availableTree.encryptedKey) {
    try {
      const decryptedKey = decryptPrivateKey(availableTree.encryptedKey)
      const secretKey = stringToSecretKey(decryptedKey)
      treeAuthorityKeypair = Keypair.fromSecretKey(secretKey)
    } catch (err) {
      console.error('解密私钥失败:', err)
      throw createError({
        statusCode: 500,
        message: '树权限密钥解密失败',
      })
    }
  }

  // 计算叶子索引
  const leafIndex = mintedCount

  // 创建 cNFT 记录（状态：铸造中）
  const cnft = await prisma.compressedNft.create({
    data: {
      merkleTreeId: availableTree.id,
      projectId: BigInt(projectId),
      assetId: `pending_${Date.now()}_${leafIndex}`, // 临时 ID，铸造成功后更新
      leafIndex,
      name,
      symbol: symbol || '',
      metadataUri: metadataUri || '',
      ownerAddress,
      status: 0, // 铸造中
    },
  })

  // 更新树的已铸造数量
  await prisma.merkleTree.update({
    where: { id: availableTree.id },
    data: { totalMinted: mintedCount + 1 },
  })

  // 返回铸造所需信息（前端使用这些信息构建交易）
  return {
    code: 0,
    data: {
      cnftId: cnft.id.toString(),
      merkleTree: {
        address: availableTree.treeAddress,
        authority: availableTree.treeAuthority,
      },
      leafIndex,
      metadata: {
        name,
        symbol: symbol || '',
        uri: metadataUri || '',
      },
      owner: ownerAddress,
      network: targetNetwork,
      rpcUrl: getRpcUrl(targetNetwork),
      // 如果有树权限私钥，返回公钥用于验证
      treeAuthorityPublicKey: treeAuthorityKeypair?.publicKey.toBase58() || availableTree.treeAuthority,
    },
    message: '铸造信息已准备，请在前端完成交易签名',
  }
})
