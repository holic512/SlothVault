/**
 * 准备铸造 cNFT 的交易
 *
 * 流程：
 * 1. 验证请求参数
 * 2. 选择可用的 Merkle Tree
 * 3. 解密树权限私钥
 * 4. （可选）处理图片：压缩 + 上传到 IPFS
 * 5. （可选）构建并上传 NFT 元数据到 IPFS
 * 6. 构建铸造交易并使用树权限部分签名
 * 7. 创建 cNFT 记录（状态：铸造中）
 * 8. 创建铸造会话存储上下文
 * 9. 返回序列化交易供前端钱包签名
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 6.1, 6.2, 6.3
 */

import { Keypair, PublicKey } from '@solana/web3.js'
import { prisma } from '~~/server/utils/prisma'
import { getConnection, type SolanaNetwork } from '~~/server/utils/solana'
import { decryptPrivateKey, stringToSecretKey } from '~~/server/utils/crypto'
import { selectAvailableTree } from '~~/server/utils/treeSelector'
import {
  buildMintCnftTransaction,
  createDefaultCnftMetadata,
  isValidSolanaAddress,
} from '~~/server/utils/bubblegum'
import { createMintSession } from '~~/server/utils/mintSession'
import {
  SolanaError,
  SolanaErrorCode,
  createSolanaHttpError,
  isRpcConnectionError,
} from '~~/server/utils/solanaErrors'
import { isFilebaseConfigured, uploadImageToFilebase } from '~~/server/utils/filebase'
import { compressForNft, isValidImage } from '~~/server/utils/imageProcessor'
import { buildAndUploadMetadata } from '~~/server/utils/nftMetadata'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

interface PrepareRequest {
  projectId: string | number
  ownerAddress: string
  name: string
  symbol?: string
  description?: string
  /** 是否使用项目头像作为 NFT 图片，默认 true */
  useProjectAvatar?: boolean
  /** 直接传入的 metadataUri（如果已有 IPFS 元数据则使用此字段，优先级最高） */
  metadataUri?: string
  payerAddress: string
  network?: 'mainnet' | 'devnet'
}

export default defineEventHandler(async (event) => {
  const body = await readBody<PrepareRequest>(event)
  const {
    projectId,
    ownerAddress,
    name,
    symbol,
    description,
    useProjectAvatar = true,
    metadataUri: inputMetadataUri,
    payerAddress,
    network = 'devnet',
  } = body

  // 1. 验证请求参数 (Requirement 3.1)
  if (!projectId) {
    throw createError({
      statusCode: 400,
      message: '缺少必要参数：projectId',
      data: { code: SolanaErrorCode.INVALID_PARAMS },
    })
  }

  if (!ownerAddress || typeof ownerAddress !== 'string') {
    throw createError({
      statusCode: 400,
      message: '缺少必要参数：ownerAddress',
      data: { code: SolanaErrorCode.INVALID_PARAMS },
    })
  }

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw createError({
      statusCode: 400,
      message: '缺少必要参数：name',
      data: { code: SolanaErrorCode.INVALID_PARAMS },
    })
  }

  // 验证名称字节长度（Bubblegum 限制 32 字节）
  const nameBytes = Buffer.from(name.trim(), 'utf8')
  if (nameBytes.length > 32) {
    throw createError({
      statusCode: 400,
      message: `NFT 名称过长（${nameBytes.length}/32 字节），请使用更短的名称`,
      data: { code: SolanaErrorCode.INVALID_PARAMS },
    })
  }

  if (!payerAddress || typeof payerAddress !== 'string') {
    throw createError({
      statusCode: 400,
      message: '缺少必要参数：payerAddress',
      data: { code: SolanaErrorCode.INVALID_PARAMS },
    })
  }

  // 2. 验证 ownerAddress 是有效的 Solana 地址 (Requirement 1.3)
  if (!isValidSolanaAddress(ownerAddress)) {
    throw createError({
      statusCode: 400,
      message: '无效的接收者地址格式',
      data: { code: SolanaErrorCode.INVALID_ADDRESS },
    })
  }

  // 验证 payerAddress 格式
  let payerPubkey: PublicKey
  try {
    payerPubkey = new PublicKey(payerAddress)
  } catch {
    throw createError({
      statusCode: 400,
      message: '无效的支付者地址格式',
      data: { code: SolanaErrorCode.INVALID_ADDRESS },
    })
  }

  // 验证网络类型
  const networkType = network as SolanaNetwork
  if (networkType !== 'mainnet' && networkType !== 'devnet') {
    throw createError({
      statusCode: 400,
      message: '网络类型必须是 mainnet 或 devnet',
      data: { code: SolanaErrorCode.INVALID_PARAMS },
    })
  }

  // 3. 验证项目存在
  const project = await prisma.project.findUnique({
    where: { id: BigInt(projectId), isDeleted: false },
    select: { id: true, projectName: true, avatar: true },
  })

  if (!project) {
    throw createError({
      statusCode: 400,
      message: '项目不存在',
      data: { code: 'PROJECT_NOT_FOUND' },
    })
  }

  // 4. 选择可用的 Merkle Tree (Requirement 2.1, 2.3)
  const availableTree = await selectAvailableTree(networkType)

  if (!availableTree) {
    throw createError({
      statusCode: 400,
      message: `没有可用的 Merkle Tree（${networkType}），请先创建`,
      data: { code: 'NO_AVAILABLE_TREE' },
    })
  }

  // 5. 解密树权限私钥 (Requirement 3.2)
  let treeAuthorityKeypair: Keypair
  try {
    const decryptedKey = decryptPrivateKey(availableTree.encryptedKey)
    const secretKey = stringToSecretKey(decryptedKey)
    treeAuthorityKeypair = Keypair.fromSecretKey(secretKey)
    
    // 验证解密后的公钥与数据库存储的一致
    const derivedAuthority = treeAuthorityKeypair.publicKey.toBase58()
    if (derivedAuthority !== availableTree.treeAuthority) {
      console.error(`[cNFT Prepare] 树权限公钥不匹配: 解密得到 ${derivedAuthority}, 数据库存储 ${availableTree.treeAuthority}`)
      throw new Error('树权限公钥不匹配')
    }
    console.log(`[cNFT Prepare] 树权限验证通过: ${derivedAuthority}`)
  } catch (err: any) {
    console.error('[cNFT Prepare] 解密私钥失败:', err)
    throw createSolanaHttpError(
      new SolanaError(SolanaErrorCode.ENCRYPTION_FAILED, '树权限密钥解密失败', 500)
    )
  }

  // 6. 获取叶子索引（等于当前 totalMinted）
  const leafIndex = availableTree.totalMinted

  // ============ 图片处理和元数据上传（可选） ============
  let finalMetadataUri = inputMetadataUri || ''
  let imageCid: string | null = null
  let metadataCid: string | null = null
  let originalImageId: bigint | null = null

  // 调试日志：输出条件判断的各个值
  console.log(`[cNFT Prepare] 图片处理条件检查:`)
  console.log(`  - inputMetadataUri: ${inputMetadataUri || '(空)'}`)
  console.log(`  - useProjectAvatar: ${useProjectAvatar}`)
  console.log(`  - project.avatar: ${project.avatar || '(空)'}`)
  console.log(`  - isFilebaseConfigured(): ${isFilebaseConfigured()}`)

  // 如果已提供 metadataUri，则跳过图片处理（优先级最高）
  // 否则，如果启用项目头像且项目有头像且 Filebase 已配置，则处理图片
  const shouldProcessImage = !inputMetadataUri && useProjectAvatar && project.avatar && isFilebaseConfigured()
  console.log(`  - shouldProcessImage: ${shouldProcessImage}`)

  if (shouldProcessImage) {
    try {
      console.log(`[cNFT Prepare] 开始处理项目头像: projectId=${projectId}, avatar=${project.avatar}`)
      
      // 6.1 根据项目头像路径读取文件
      // avatar 格式如: /uploads/project-avatar/xxx.png
      const avatarPath = project.avatar!
      const absolutePath = join(process.cwd(), 'public', avatarPath.startsWith('/') ? avatarPath.slice(1) : avatarPath)
      
      console.log(`[cNFT Prepare] 图片绝对路径: ${absolutePath}`)
      
      if (!existsSync(absolutePath)) {
        console.warn(`[cNFT Prepare] 项目头像文件不存在: ${absolutePath}，跳过图片处理`)
      } else {
        // 6.2 读取图片文件
        const imageBuffer = await readFile(absolutePath)
        console.log(`[cNFT Prepare] 读取图片成功: ${imageBuffer.length} bytes`)

        // 6.3 验证是否为有效图片
        if (!await isValidImage(imageBuffer)) {
          console.warn(`[cNFT Prepare] 无效的图片文件格式，跳过图片处理`)
        } else {
          // 6.4 压缩图片
          console.log(`[cNFT Prepare] 压缩图片中...`)
          const compressResult = await compressForNft(imageBuffer)
          console.log(`[cNFT Prepare] 图片压缩完成: ${compressResult.originalSize} -> ${compressResult.size} bytes (${(compressResult.compressionRatio * 100).toFixed(1)}% 压缩率)`)

          // 6.5 上传图片到 Filebase (IPFS)
          console.log(`[cNFT Prepare] 上传图片到 IPFS...`)
          const imageFileName = `${name.trim().replace(/[^a-zA-Z0-9]/g, '_')}.${compressResult.extension}`
          const imageUploadResult = await uploadImageToFilebase(
            compressResult.buffer,
            imageFileName,
            compressResult.mimeType
          )
          imageCid = imageUploadResult.cid
          console.log(`[cNFT Prepare] 图片上传成功: CID=${imageCid}`)

          // 6.6 构建并上传元数据到 IPFS
          console.log(`[cNFT Prepare] 构建并上传元数据...`)
          const metadataResult = await buildAndUploadMetadata({
            name: name.trim(),
            symbol: symbol || '',
            description: description || `${project.projectName} - ${name.trim()}`,
            imageCid,
            imageMimeType: compressResult.mimeType,
            creatorAddress: treeAuthorityKeypair.publicKey.toBase58(),
          })
          metadataCid = metadataResult.metadataCid
          finalMetadataUri = metadataResult.metadataUri
          console.log(`[cNFT Prepare] 元数据上传成功: CID=${metadataCid}, URI=${finalMetadataUri}`)
        }
      }
    } catch (err: any) {
      // 图片处理失败不阻断铸造流程，只记录警告
      console.error('[cNFT Prepare] 图片处理失败，继续无图片铸造:', err.message)
    }
  } else if (!inputMetadataUri && useProjectAvatar && project.avatar && !isFilebaseConfigured()) {
    // 有头像但 Filebase 未配置
    console.warn('[cNFT Prepare] 项目有头像但 Filebase 未配置，跳过图片处理')
  } else if (!inputMetadataUri && useProjectAvatar && !project.avatar) {
    // 启用头像但项目没有头像
    console.log('[cNFT Prepare] 项目没有头像，跳过图片处理')
  }

  // 7. 构建铸造交易 (Requirement 3.3, 3.4)
  let transaction
  let connection

  try {
    connection = getConnection(networkType)
    const merkleTreePubkey = new PublicKey(availableTree.treeAddress)
    const ownerPubkey = new PublicKey(ownerAddress)

    // 创建元数据
    const metadata = createDefaultCnftMetadata(
      name.trim(),
      symbol || '',
      finalMetadataUri,
      treeAuthorityKeypair.publicKey
    )

    const result = await buildMintCnftTransaction(
      connection,
      payerPubkey,
      treeAuthorityKeypair,
      merkleTreePubkey,
      ownerPubkey,
      metadata,
      leafIndex
    )

    transaction = result.transaction
  } catch (err: any) {
    console.error('[cNFT Prepare] 构建交易失败:', err)

    if (isRpcConnectionError(err)) {
      throw createSolanaHttpError(
        new SolanaError(SolanaErrorCode.RPC_CONNECTION_FAILED, undefined, 503)
      )
    }

    throw createSolanaHttpError(
      new SolanaError(SolanaErrorCode.TRANSACTION_BUILD_FAILED, err.message, 500)
    )
  }

  // 8. 使用树权限 Keypair 对交易进行部分签名 (Requirement 3.4)
  try {
    transaction.partialSign(treeAuthorityKeypair)
  } catch (err: any) {
    console.error('[cNFT Prepare] 部分签名失败:', err)
    throw createSolanaHttpError(
      new SolanaError(SolanaErrorCode.TRANSACTION_SIGN_FAILED, err.message, 500)
    )
  }

  // 9. 创建 cNFT 记录（状态：铸造中）(Requirement 6.1, 6.2, 6.3)
  let cnft
  try {
    // 构建创建数据（新字段需要数据库迁移后才能使用）
    const createData: any = {
      merkleTreeId: availableTree.id,
      projectId: BigInt(projectId),
      assetId: `pending_${Date.now()}_${leafIndex}`, // 临时 ID，铸造成功后更新
      leafIndex,
      name: name.trim(),
      symbol: symbol || null,
      metadataUri: finalMetadataUri || null,
      ownerAddress,
      status: 0, // 铸造中
    }

    // 新增字段（数据库迁移后生效）
    if (description) createData.description = description
    if (imageCid) createData.imageCid = imageCid
    if (metadataCid) createData.metadataCid = metadataCid
    if (originalImageId) createData.originalImageId = originalImageId

    cnft = await prisma.compressedNft.create({
      data: createData,
    })

    // 更新树的已铸造数量
    await prisma.merkleTree.update({
      where: { id: availableTree.id },
      data: {
        totalMinted: leafIndex + 1,
        updatedAt: new Date(),
      },
    })
  } catch (err: any) {
    console.error('[cNFT Prepare] 创建记录失败:', err)
    throw createSolanaHttpError(
      new SolanaError(SolanaErrorCode.DATABASE_ERROR, err.message, 500)
    )
  }

  // 10. 创建铸造会话存储上下文 (Requirement 3.5)
  const sessionId = createMintSession({
    treeAuthorityKeypair,
    merkleTreeId: availableTree.id,
    merkleTreeAddress: availableTree.treeAddress,
    cnftId: cnft.id,
    leafIndex,
    payerAddress,
    network: networkType,
  })

  // 11. 序列化交易（Base64）(Requirement 3.6)
  const transactionBase64 = transaction.serialize({
    requireAllSignatures: false, // 允许部分签名
    verifySignatures: false,
  }).toString('base64')

  // 计算会话过期时间（5 分钟后）
  const expiresAt = Date.now() + 5 * 60 * 1000

  console.log(`[cNFT Prepare] 准备交易成功: cnft=${cnft.id}, tree=${availableTree.treeAddress}, session=${sessionId.substring(0, 8)}...`)

  // 12. 返回响应 (Requirement 3.6)
  return {
    code: 0,
    data: {
      transactionBase64,
      sessionId,
      merkleTree: {
        id: availableTree.id.toString(),
        address: availableTree.treeAddress,
        name: availableTree.name,
      },
      leafIndex,
      cnftId: cnft.id.toString(),
      expiresAt,
      // 图片相关信息（如果有）
      ...(imageCid && {
        image: {
          cid: imageCid,
          ipfsUri: `ipfs://${imageCid}`,
          gatewayUrl: `https://ipfs.filebase.io/ipfs/${imageCid}`,
        },
      }),
      ...(metadataCid && {
        metadata: {
          cid: metadataCid,
          ipfsUri: finalMetadataUri,
          gatewayUrl: `https://ipfs.filebase.io/ipfs/${metadataCid}`,
        },
      }),
    },
    message: imageCid 
      ? '铸造交易已准备（含 IPFS 图片），请在钱包中签名' 
      : '铸造交易已准备，请在钱包中签名',
  }
})
