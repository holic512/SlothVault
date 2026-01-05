/**
 * Solana 工具函数
 * 用于服务端 Solana 操作
 * 
 * 注意：@solana/spl-account-compression 只在服务端使用
 * Nuxt 配置中已将其标记为外部依赖，避免 SSR 问题
 */

import {
  Connection,
  clusterApiUrl,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'

// 动态导入 spl-account-compression（仅服务端）
import {
  createAllocTreeIx,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
} from '@solana/spl-account-compression'

// Bubblegum 程序 ID
const BUBBLEGUM_PROGRAM_ID = new PublicKey(
  'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY'
)

// SPL Noop 程序 ID
const SPL_NOOP_PROGRAM_ID = new PublicKey(
  'noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV'
)

export type SolanaNetwork = 'mainnet' | 'devnet'

/**
 * 获取 RPC URL
 * 优先使用环境变量配置的 RPC（如 Helius），中国可访问
 */
export function getRpcUrl(network: SolanaNetwork = 'devnet'): string {
  if (network === 'mainnet') {
    return process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta')
  }
  // devnet 优先使用 Helius devnet RPC
  return process.env.SOLANA_DEVNET_RPC_URL || clusterApiUrl('devnet')
}

/**
 * 获取 Solana RPC 连接
 * 配置较长的超时时间以适应网络环境
 */
export function getConnection(network: SolanaNetwork = 'devnet'): Connection {
  const rpcUrl = getRpcUrl(network)

  return new Connection(rpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000, // 60秒超时
  })
}

/**
 * 格式化 lamports 为 SOL
 */
export function lamportsToSol(lamports: number | bigint): string {
  const LAMPORTS_PER_SOL = 1_000_000_000
  return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(4)
}

/**
 * SOL 转 lamports
 */
export function solToLamports(sol: number): number {
  const LAMPORTS_PER_SOL = 1_000_000_000
  return Math.floor(sol * LAMPORTS_PER_SOL)
}

/**
 * 计算 Merkle Tree 账户所需空间（字节）
 * 
 * 根据 SPL Account Compression 的空间计算公式：
 * - Header: 固定大小 (discriminator + header fields)
 * - Changelog: maxBufferSize * (32 + 4 + 32 * maxDepth)
 * - Canopy: (2^(canopyDepth+1) - 2) * 32
 * - Root History: maxBufferSize * 32
 * 
 * @param maxDepth - 树的最大深度，决定最大容量 (2^maxDepth)
 * @param maxBufferSize - 最大缓冲区大小，决定并发更新能力
 * @param canopyDepth - 树冠深度，减少证明大小
 * @returns 所需字节数
 */
export function calculateTreeSpace(
  maxDepth: number,
  maxBufferSize: number,
  canopyDepth: number = 0
): number {
  // 验证参数
  if (maxDepth < 1 || maxDepth > 30) {
    throw new Error('maxDepth 必须在 1-30 之间')
  }
  if (maxBufferSize < 1) {
    throw new Error('maxBufferSize 必须大于 0')
  }
  if (canopyDepth < 0 || canopyDepth > maxDepth) {
    throw new Error('canopyDepth 必须在 0 到 maxDepth 之间')
  }

  // ConcurrentMerkleTreeHeader 大小
  // discriminator (8) + max_buffer_size (4) + max_depth (4) + authority (32) + 
  // creation_slot (8) + is_batch_initialized (1) + padding (7) + 
  // active_index (8) + buffer_size (8) + rightmost_proof (32 * maxDepth) + 
  // rightmost_leaf (32) + rightmost_index (4)
  const HEADER_SIZE = 8 + 4 + 4 + 32 + 8 + 1 + 7 + 8 + 8 + (32 * maxDepth) + 32 + 4

  // Changelog 大小
  // 每个 changelog entry: root (32) + path_len (4) + path (32 * maxDepth)
  const CHANGELOG_ENTRY_SIZE = 32 + 4 + (32 * maxDepth)
  const CHANGELOG_SIZE = maxBufferSize * CHANGELOG_ENTRY_SIZE

  // Canopy 大小
  // 存储树的前 canopyDepth 层节点，减少链上证明大小
  // 节点数 = 2^(canopyDepth+1) - 2
  const canopyNodes = canopyDepth > 0 ? Math.pow(2, canopyDepth + 1) - 2 : 0
  const CANOPY_SIZE = canopyNodes * 32

  return HEADER_SIZE + CHANGELOG_SIZE + CANOPY_SIZE
}

/**
 * 获取 TreeConfig PDA
 * 
 * TreeConfig 是 Bubblegum 程序用于存储树配置的 PDA 账户
 * 派生规则：seeds = [merkle_tree], program = BUBBLEGUM_PROGRAM_ID
 */
function getTreeConfigPda(merkleTree: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [merkleTree.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  )
}

/**
 * 创建 Bubblegum createTree 指令
 * 
 * 这个指令会：
 * 1. 初始化 Merkle Tree（调用 spl-account-compression）
 * 2. 创建 TreeConfig PDA 账户
 * 
 * @param treeConfig - TreeConfig PDA
 * @param merkleTree - Merkle Tree 公钥
 * @param payer - 支付者（也是树的 authority）
 * @param treeCreator - 树创建者（通常与 payer 相同）
 * @param maxDepth - 树的最大深度
 * @param maxBufferSize - 最大缓冲区大小
 * @param isPublic - 是否公开（允许任何人铸造）
 */
function createBubblegumCreateTreeInstruction(
  treeConfig: PublicKey,
  merkleTree: PublicKey,
  payer: PublicKey,
  treeCreator: PublicKey,
  maxDepth: number,
  maxBufferSize: number,
  isPublic: boolean = false
): TransactionInstruction {
  // createTree 指令的 discriminator
  // 通过 anchor discriminator 计算: sha256("global:create_tree")[0..8]
  const CREATE_TREE_DISCRIMINATOR = Buffer.from([165, 83, 136, 142, 89, 202, 47, 220])

  // 构建指令数据
  // maxDepth (u32) + maxBufferSize (u32) + public (Option<bool>)
  const data = Buffer.alloc(8 + 4 + 4 + 2) // discriminator + maxDepth + maxBufferSize + Option<bool>
  CREATE_TREE_DISCRIMINATOR.copy(data, 0)
  data.writeUInt32LE(maxDepth, 8)
  data.writeUInt32LE(maxBufferSize, 12)
  // Option<bool>: 1 = Some, then 1/0 for true/false
  data.writeUInt8(1, 16) // Some
  data.writeUInt8(isPublic ? 1 : 0, 17)

  // 构建账户列表
  const keys = [
    { pubkey: treeConfig, isSigner: false, isWritable: true },
    { pubkey: merkleTree, isSigner: false, isWritable: true },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: treeCreator, isSigner: true, isWritable: false },
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
 * 构建创建 Merkle Tree 的交易结果
 */
export interface BuildCreateTreeResult {
  transaction: Transaction
  rentLamports: number
  spaceBytes: number
  treeAuthorityKeypair: Keypair
}

/**
 * 构建创建 Merkle Tree 的交易（使用 Bubblegum）
 * 
 * 使用 @solana/spl-account-compression 和 Bubblegum 程序构建：
 * 1. createAllocTreeIx - 分配账户空间
 * 2. Bubblegum createTree - 初始化树并创建 TreeConfig PDA
 * 
 * 重要：生成独立的 treeAuthority Keypair 作为树的管理权限，
 * 这样服务端可以持有私钥用于后续铸造 cNFT。
 * 
 * @param connection - Solana RPC 连接
 * @param payer - 支付者公钥
 * @param treeKeypair - 树账户 Keypair
 * @param maxDepth - 树的最大深度
 * @param maxBufferSize - 最大缓冲区大小
 * @param canopyDepth - 树冠深度
 * @returns 交易对象、租金信息和 treeAuthority Keypair
 */
export async function buildCreateTreeTransaction(
  connection: Connection,
  payer: PublicKey,
  treeKeypair: Keypair,
  maxDepth: number,
  maxBufferSize: number,
  canopyDepth: number = 0
): Promise<BuildCreateTreeResult> {
  // 计算所需空间
  const spaceBytes = calculateTreeSpace(maxDepth, maxBufferSize, canopyDepth)

  // 获取租金
  const rentLamports = await connection.getMinimumBalanceForRentExemption(spaceBytes)

  // 生成独立的 treeAuthority Keypair（用于后续铸造签名）
  const treeAuthorityKeypair = Keypair.generate()

  // 1. 使用官方库创建分配账户空间的指令
  const allocAccountIx = await createAllocTreeIx(
    connection,
    treeKeypair.publicKey,
    payer,
    { maxDepth, maxBufferSize },
    canopyDepth
  )

  // 2. 获取 TreeConfig PDA
  const [treeConfigPda] = getTreeConfigPda(treeKeypair.publicKey)

  // 3. 创建 Bubblegum createTree 指令
  // treeCreator 使用独立生成的 treeAuthorityKeypair，而不是 payer
  // 这样服务端可以持有 treeAuthority 私钥用于铸造
  const createTreeIx = createBubblegumCreateTreeInstruction(
    treeConfigPda,
    treeKeypair.publicKey,
    payer,
    treeAuthorityKeypair.publicKey, // 使用独立的 authority
    maxDepth,
    maxBufferSize,
    false // 非公开树，只有 authority 可以铸造
  )

  // 构建交易
  const transaction = new Transaction()
  transaction.add(allocAccountIx)
  transaction.add(createTreeIx)

  // 获取最新的 blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  transaction.recentBlockhash = blockhash
  transaction.lastValidBlockHeight = lastValidBlockHeight
  transaction.feePayer = payer

  return {
    transaction,
    rentLamports,
    spaceBytes,
    treeAuthorityKeypair,
  }
}
