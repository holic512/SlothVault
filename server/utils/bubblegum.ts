/**
 * Bubblegum ESM 包装层
 *
 * 目的：为其他 TypeScript 文件提供类型安全的 ESM 接口
 * 实际实现委托给 CJS 模块
 */

import { getSolanaCjs } from './solanaCjsLoader'
import type { Connection, PublicKey, Transaction, Keypair } from '@solana/web3.js'

// 获取 CJS 模块实例
const solanaCjs = getSolanaCjs()

/**
 * Creator 结构
 */
export interface Creator {
  address: PublicKey
  verified: boolean
  share: number
}

/**
 * cNFT 元数据结构
 */
export interface CnftMetadata {
  name: string
  symbol: string
  uri: string
  sellerFeeBasisPoints: number
  creators: Creator[]
  isMutable?: boolean
  primarySaleHappened?: boolean
  collection?: {
    verified: boolean
    key: PublicKey
  } | null
  uses?: {
    useMethod: number
    remaining: bigint
    total: bigint
  } | null
}

/**
 * 获取 Asset ID
 */
export function getAssetId(merkleTree: PublicKey, leafIndex: number): [PublicKey, number] {
  return solanaCjs.getAssetId(merkleTree, leafIndex)
}

/**
 * 构建 cNFT 铸造交易结果
 */
export interface BuildMintCnftTransactionResult {
  transaction: Transaction
  leafIndex: number
  treeConfigPda: PublicKey
}

/**
 * 构建 cNFT 铸造交易
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
  return await solanaCjs.buildMintCnftTransaction(
    connection,
    payer,
    treeAuthority,
    merkleTree,
    leafOwner,
    metadata,
    leafIndex
  )
}

/**
 * 创建默认的 cNFT 元数据
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
