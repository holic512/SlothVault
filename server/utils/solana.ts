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
  createInitEmptyMerkleTreeIx,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
} from '@solana/spl-account-compression'

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
 * 构建创建 Merkle Tree 的交易
 * 
 * 使用 @solana/spl-account-compression 库构建：
 * 1. createAllocTreeIx - 分配账户空间
 * 2. createInitEmptyMerkleTreeIx - 初始化空树
 * 
 * @param connection - Solana RPC 连接
 * @param payer - 支付者公钥
 * @param treeKeypair - 树账户 Keypair
 * @param maxDepth - 树的最大深度
 * @param maxBufferSize - 最大缓冲区大小
 * @param canopyDepth - 树冠深度
 * @returns 交易对象和租金信息
 */
export async function buildCreateTreeTransaction(
  connection: Connection,
  payer: PublicKey,
  treeKeypair: Keypair,
  maxDepth: number,
  maxBufferSize: number,
  canopyDepth: number = 0
): Promise<{ transaction: Transaction; rentLamports: number; spaceBytes: number }> {
  // 计算所需空间
  const spaceBytes = calculateTreeSpace(maxDepth, maxBufferSize, canopyDepth)

  // 获取租金
  const rentLamports = await connection.getMinimumBalanceForRentExemption(spaceBytes)

  // 使用官方库创建分配账户空间的指令
  const allocAccountIx = await createAllocTreeIx(
    connection,
    treeKeypair.publicKey,
    payer,
    { maxDepth, maxBufferSize },
    canopyDepth
  )

  // 使用官方库创建初始化空 Merkle Tree 的指令
  const initTreeIx = createInitEmptyMerkleTreeIx(
    treeKeypair.publicKey,
    payer, // authority
    { maxDepth, maxBufferSize }
  )

  // 构建交易
  const transaction = new Transaction()
  transaction.add(allocAccountIx)
  transaction.add(initTreeIx)

  // 获取最新的 blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  transaction.recentBlockhash = blockhash
  transaction.lastValidBlockHeight = lastValidBlockHeight
  transaction.feePayer = payer

  return {
    transaction,
    rentLamports,
    spaceBytes,
  }
}
