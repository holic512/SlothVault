/**
 * Bubblegum 铸造工具模块
 *
 * 用于构建 cNFT 铸造交易，包括：
 * - TreeConfig PDA 计算
 * - Asset ID 计算
 * - mintV1 指令构建
 *
 * Requirements: 3.3, 3.4
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  SystemProgram,
} from '@solana/web3.js'
import { SPL_ACCOUNT_COMPRESSION_PROGRAM_ID } from '@solana/spl-account-compression'

// Bubblegum 程序 ID (Mainnet & Devnet)
// 官方地址: https://github.com/metaplex-foundation/mpl-bubblegum
export const BUBBLEGUM_PROGRAM_ID = new PublicKey(
  'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY'
)

// SPL Noop 程序 ID
export const SPL_NOOP_PROGRAM_ID = new PublicKey(
  'noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV'
)

/**
 * Creator 结构
 */
export interface Creator {
  /** 创建者地址 */
  address: PublicKey
  /** 是否已验证 */
  verified: boolean
  /** 分成比例 (0-100) */
  share: number
}

/**
 * cNFT 元数据结构
 */
export interface CnftMetadata {
  /** NFT 名称 */
  name: string
  /** NFT 符号 */
  symbol: string
  /** 元数据 URI */
  uri: string
  /** 销售费用基点 (0-10000, 100 = 1%) */
  sellerFeeBasisPoints: number
  /** 创建者列表 */
  creators: Creator[]
  /** 是否可变 */
  isMutable?: boolean
  /** 主要销售是否已发生 */
  primarySaleHappened?: boolean
  /** 集合信息（可选） */
  collection?: {
    verified: boolean
    key: PublicKey
  } | null
  /** 用途信息（可选） */
  uses?: {
    useMethod: number
    remaining: bigint
    total: bigint
  } | null
}

/**
 * 获取 TreeConfig PDA
 *
 * TreeConfig 是 Bubblegum 程序用于存储树配置的 PDA 账户
 * 派生规则：seeds = [merkle_tree], program = BUBBLEGUM_PROGRAM_ID
 *
 * @param merkleTree - Merkle Tree 公钥
 * @returns TreeConfig PDA 公钥和 bump
 */
export function getTreeConfigPda(merkleTree: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [merkleTree.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  )
}

/**
 * 获取 Asset ID (Leaf Asset ID PDA)
 *
 * Asset ID 是 cNFT 的唯一标识符
 * 派生规则：seeds = ["asset", merkle_tree, leaf_index], program = BUBBLEGUM_PROGRAM_ID
 *
 * @param merkleTree - Merkle Tree 公钥
 * @param leafIndex - 叶子索引
 * @returns Asset ID 公钥和 bump
 */
export function getAssetId(merkleTree: PublicKey, leafIndex: number): [PublicKey, number] {
  // 将 leafIndex 转换为 8 字节小端序 Buffer
  const leafIndexBuffer = Buffer.alloc(8)
  leafIndexBuffer.writeBigUInt64LE(BigInt(leafIndex))

  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('asset'),
      merkleTree.toBuffer(),
      leafIndexBuffer,
    ],
    BUBBLEGUM_PROGRAM_ID
  )
}

/**
 * 验证 Solana 地址格式
 *
 * @param address - 地址字符串
 * @returns 是否为有效的 Solana 地址
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    const pubkey = new PublicKey(address)
    // 确保是有效的 Base58 编码且长度正确
    return PublicKey.isOnCurve(pubkey.toBuffer()) || true // PublicKey 构造成功即为有效
  } catch {
    return false
  }
}


/**
 * MetadataArgs 结构（用于 mintV1 指令）
 * 这是 Bubblegum 程序期望的元数据格式
 */
interface MetadataArgsInput {
  name: string
  symbol: string
  uri: string
  sellerFeeBasisPoints: number
  primarySaleHappened: boolean
  isMutable: boolean
  editionNonce: number | null
  tokenStandard: number | null
  collection: { verified: boolean; key: PublicKey } | null
  uses: { useMethod: number; remaining: bigint; total: bigint } | null
  tokenProgramVersion: number
  creators: { address: PublicKey; verified: boolean; share: number }[]
}

/**
 * 序列化 MetadataArgs 为 Borsh 格式
 *
 * Bubblegum 使用 Borsh 序列化，需要按照特定格式编码
 */
function serializeMetadataArgs(metadata: MetadataArgsInput): Buffer {
  const buffers: Buffer[] = []

  // name (string: 4 bytes length + data)
  const nameBytes = Buffer.from(metadata.name, 'utf8')
  const nameLen = Buffer.alloc(4)
  nameLen.writeUInt32LE(nameBytes.length)
  buffers.push(nameLen, nameBytes)

  // symbol (string: 4 bytes length + data)
  const symbolBytes = Buffer.from(metadata.symbol, 'utf8')
  const symbolLen = Buffer.alloc(4)
  symbolLen.writeUInt32LE(symbolBytes.length)
  buffers.push(symbolLen, symbolBytes)

  // uri (string: 4 bytes length + data)
  const uriBytes = Buffer.from(metadata.uri, 'utf8')
  const uriLen = Buffer.alloc(4)
  uriLen.writeUInt32LE(uriBytes.length)
  buffers.push(uriLen, uriBytes)

  // seller_fee_basis_points (u16)
  const sellerFee = Buffer.alloc(2)
  sellerFee.writeUInt16LE(metadata.sellerFeeBasisPoints)
  buffers.push(sellerFee)

  // primary_sale_happened (bool)
  buffers.push(Buffer.from([metadata.primarySaleHappened ? 1 : 0]))

  // is_mutable (bool)
  buffers.push(Buffer.from([metadata.isMutable ? 1 : 0]))

  // edition_nonce (Option<u8>)
  if (metadata.editionNonce !== null) {
    buffers.push(Buffer.from([1, metadata.editionNonce]))
  } else {
    buffers.push(Buffer.from([0]))
  }

  // token_standard (Option<TokenStandard>)
  if (metadata.tokenStandard !== null) {
    buffers.push(Buffer.from([1, metadata.tokenStandard]))
  } else {
    buffers.push(Buffer.from([0]))
  }

  // collection (Option<Collection>)
  if (metadata.collection !== null) {
    buffers.push(Buffer.from([1])) // Some
    buffers.push(Buffer.from([metadata.collection.verified ? 1 : 0]))
    buffers.push(metadata.collection.key.toBuffer())
  } else {
    buffers.push(Buffer.from([0])) // None
  }

  // uses (Option<Uses>)
  if (metadata.uses !== null) {
    buffers.push(Buffer.from([1])) // Some
    buffers.push(Buffer.from([metadata.uses.useMethod]))
    const remaining = Buffer.alloc(8)
    remaining.writeBigUInt64LE(metadata.uses.remaining)
    buffers.push(remaining)
    const total = Buffer.alloc(8)
    total.writeBigUInt64LE(metadata.uses.total)
    buffers.push(total)
  } else {
    buffers.push(Buffer.from([0])) // None
  }

  // token_program_version (TokenProgramVersion enum: 0 = Original, 1 = Token2022)
  buffers.push(Buffer.from([metadata.tokenProgramVersion]))

  // creators (Vec<Creator>)
  const creatorsLen = Buffer.alloc(4)
  creatorsLen.writeUInt32LE(metadata.creators.length)
  buffers.push(creatorsLen)

  for (const creator of metadata.creators) {
    buffers.push(creator.address.toBuffer())
    buffers.push(Buffer.from([creator.verified ? 1 : 0]))
    buffers.push(Buffer.from([creator.share]))
  }

  return Buffer.concat(buffers)
}

/**
 * 创建 mintV1 指令
 *
 * @param treeConfig - TreeConfig PDA
 * @param leafOwner - cNFT 所有者
 * @param leafDelegate - cNFT 委托者（通常与 leafOwner 相同）
 * @param merkleTree - Merkle Tree 公钥
 * @param payer - 支付者
 * @param treeCreatorOrDelegate - 树创建者或委托者（需要签名）
 * @param metadata - NFT 元数据
 * @returns TransactionInstruction
 */
export function createMintV1Instruction(
  treeConfig: PublicKey,
  leafOwner: PublicKey,
  leafDelegate: PublicKey,
  merkleTree: PublicKey,
  payer: PublicKey,
  treeCreatorOrDelegate: PublicKey,
  metadata: CnftMetadata
): TransactionInstruction {
  // mintV1 指令的 discriminator (8 bytes)
  // 通过 anchor discriminator 计算: sha256("global:mint_v1")[0..8]
  const MINT_V1_DISCRIMINATOR = Buffer.from([145, 98, 192, 118, 184, 147, 118, 104])

  // 构建 MetadataArgs
  const metadataArgs: MetadataArgsInput = {
    name: metadata.name,
    symbol: metadata.symbol,
    uri: metadata.uri,
    sellerFeeBasisPoints: metadata.sellerFeeBasisPoints,
    primarySaleHappened: metadata.primarySaleHappened ?? false,
    isMutable: metadata.isMutable ?? true,
    editionNonce: null,
    tokenStandard: 0, // NonFungible = 0（Bubblegum 只支持 NonFungible）
    collection: metadata.collection ?? null,
    uses: metadata.uses ?? null,
    tokenProgramVersion: 0, // Original
    creators: metadata.creators.map(c => ({
      address: c.address,
      verified: c.verified,
      share: c.share,
    })),
  }

  // 序列化指令数据
  const metadataBuffer = serializeMetadataArgs(metadataArgs)
  const data = Buffer.concat([MINT_V1_DISCRIMINATOR, metadataBuffer])

  // 构建账户列表
  const keys = [
    { pubkey: treeConfig, isSigner: false, isWritable: true },
    { pubkey: leafOwner, isSigner: false, isWritable: false },
    { pubkey: leafDelegate, isSigner: false, isWritable: false },
    { pubkey: merkleTree, isSigner: false, isWritable: true },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: treeCreatorOrDelegate, isSigner: true, isWritable: false },
    { pubkey: SPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]

  return new TransactionInstruction({
    keys,
    programId: BUBBLEGUM_PROGRAM_ID,
    data,
  })
}

/**
 * 构建 cNFT 铸造交易结果
 */
export interface BuildMintCnftTransactionResult {
  /** 构建好的交易 */
  transaction: Transaction
  /** 叶子索引（等于铸造前的 totalMinted） */
  leafIndex: number
  /** TreeConfig PDA */
  treeConfigPda: PublicKey
}

/**
 * 构建 cNFT 铸造交易
 *
 * 使用 Bubblegum 程序的 mintV1 指令构建铸造交易
 * 交易需要两个签名：
 * 1. payer - 支付交易费用
 * 2. treeAuthority - 树权限（授权铸造）
 *
 * @param connection - Solana RPC 连接
 * @param payer - 支付者公钥
 * @param treeAuthority - 树权限 Keypair（用于签名）
 * @param merkleTree - Merkle Tree 公钥
 * @param leafOwner - cNFT 接收者公钥
 * @param metadata - NFT 元数据
 * @param leafIndex - 叶子索引（从数据库获取的 totalMinted）
 * @returns 交易和叶子索引
 */
export async function buildMintCnftTransaction(
  connection: Connection,
  payer: PublicKey,
  treeAuthority: Keypair,
  merkleTree: PublicKey,
  leafOwner: PublicKey,
  metadata: CnftMetadata,
  leafIndex: number
): Promise<BuildMintCnftTransactionResult> {
  // 1. 获取 TreeConfig PDA
  const [treeConfigPda] = getTreeConfigPda(merkleTree)

  // 2. 创建 mintV1 指令
  const mintIx = createMintV1Instruction(
    treeConfigPda,
    leafOwner,
    leafOwner, // leafDelegate 与 leafOwner 相同
    merkleTree,
    payer,
    treeAuthority.publicKey,
    metadata
  )

  // 3. 构建交易
  const transaction = new Transaction()
  transaction.add(mintIx)

  // 4. 获取最新的 blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  transaction.recentBlockhash = blockhash
  transaction.lastValidBlockHeight = lastValidBlockHeight
  transaction.feePayer = payer

  return {
    transaction,
    leafIndex,
    treeConfigPda,
  }
}

/**
 * 创建默认的 cNFT 元数据
 *
 * @param name - NFT 名称
 * @param symbol - NFT 符号（默认空）
 * @param uri - 元数据 URI（默认空）
 * @param creatorAddress - 创建者地址
 * @returns CnftMetadata
 */
export function createDefaultCnftMetadata(
  name: string,
  symbol: string = '',
  uri: string = '',
  creatorAddress: PublicKey
): CnftMetadata {
  return {
    name,
    symbol,
    uri,
    sellerFeeBasisPoints: 0,
    creators: [
      {
        address: creatorAddress,
        verified: true,
        share: 100,
      },
    ],
    isMutable: true,
    primarySaleHappened: false,
    collection: null,
    uses: null,
  }
}
