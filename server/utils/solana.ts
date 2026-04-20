/**
 * Solana ESM 包装层
 *
 * 目的：为其他 TypeScript 文件提供类型安全的 ESM 接口
 * 实际实现委托给 CJS 模块
 */

import { getSolanaCjs } from './solanaCjsLoader'
import type { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'

// 获取 CJS 模块实例
const solanaCjs = getSolanaCjs()

/**
 * Solana 网络类型
 */
export type SolanaNetwork = 'mainnet' | 'devnet'

/**
 * 获取 RPC URL
 */
export async function getRpcUrl(network: SolanaNetwork = 'devnet'): Promise<string> {
  // 从数据库配置获取
  const { getSolanaRpcUrl, getSolanaDevnetRpcUrl } = await import('./configCache')

  if (network === 'mainnet') {
    const url = await getSolanaRpcUrl()
    return url || solanaCjs.getDefaultRpcUrl('mainnet')
  }
  const url = await getSolanaDevnetRpcUrl()
  return url || solanaCjs.getDefaultRpcUrl('devnet')
}

/**
 * 获取 Solana RPC 连接
 */
export async function getConnection(network: SolanaNetwork = 'devnet'): Promise<Connection> {
  const rpcUrl = await getRpcUrl(network)
  return solanaCjs.createConnection(rpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000,
  })
}

/**
 * 格式化 lamports 为 SOL
 */
export function lamportsToSol(lamports: number | bigint): string {
  return solanaCjs.lamportsToSol(lamports)
}

/**
 * SOL 转 lamports
 */
export function solToLamports(sol: number): number {
  return solanaCjs.solToLamports(sol)
}

/**
 * 获取当前激活网络
 */
export async function getActiveNetwork(): Promise<SolanaNetwork> {
  const { getActiveSolanaNetwork } = await import('./configCache')
  return getActiveSolanaNetwork()
}

/**
 * 计算 Merkle Tree 账户所需空间
 */
export function calculateTreeSpace(
  maxDepth: number,
  maxBufferSize: number,
  canopyDepth: number = 0
): number {
  return solanaCjs.calculateTreeSpace(maxDepth, maxBufferSize, canopyDepth)
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
 * 构建创建 Merkle Tree 的交易
 */
export async function buildCreateTreeTransaction(
  connection: Connection,
  payer: PublicKey,
  treeKeypair: Keypair,
  maxDepth: number,
  maxBufferSize: number,
  canopyDepth: number = 0
): Promise<BuildCreateTreeResult> {
  return await solanaCjs.buildCreateTreeTransaction(
    connection,
    payer,
    treeKeypair,
    maxDepth,
    maxBufferSize,
    canopyDepth
  )
}

/**
 * 从私钥字节数组创建 Keypair
 */
export function keypairFromSecretKey(secretKey: Uint8Array): Keypair {
  return solanaCjs.keypairFromSecretKey(Array.from(secretKey))
}

/**
 * 从 base58 字符串创建 PublicKey
 */
export function publicKeyFromString(str: string): PublicKey {
  return solanaCjs.publicKeyFromString(str)
}

/**
 * 生成新的 Keypair
 */
export function generateKeypair(): Keypair {
  return solanaCjs.generateKeypair()
}

/**
 * 验证 Solana 地址
 */
export function isValidSolanaAddress(address: string): boolean {
  return solanaCjs.isValidSolanaAddress(address)
}

/**
 * 获取 TreeConfig PDA
 */
export function getTreeConfigPda(merkleTree: PublicKey): [PublicKey, number] {
  return solanaCjs.getTreeConfigPda(merkleTree)
}

// 重新导出常量
export const BUBBLEGUM_PROGRAM_ID = solanaCjs.BUBBLEGUM_PROGRAM_ID
export const SPL_NOOP_PROGRAM_ID = solanaCjs.SPL_NOOP_PROGRAM_ID
export const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = solanaCjs.SPL_ACCOUNT_COMPRESSION_PROGRAM_ID
