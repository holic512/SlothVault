/**
 * @solana/spl-account-compression 类型声明 (v0.1.10)
 */

declare module '@solana/spl-account-compression' {
  import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js'

  export interface ValidDepthSizePair {
    maxDepth: number
    maxBufferSize: number
  }

  /**
   * SPL Account Compression 程序地址
   */
  export const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID: PublicKey

  /**
   * SPL Noop 程序地址
   */
  export const SPL_NOOP_PROGRAM_ID: PublicKey

  /**
   * 创建分配 Merkle Tree 账户空间的指令
   */
  export function createAllocTreeIx(
    connection: Connection,
    merkleTree: PublicKey,
    payer: PublicKey,
    depthSizePair: ValidDepthSizePair,
    canopyDepth: number
  ): Promise<TransactionInstruction>

  /**
   * 创建初始化空 Merkle Tree 的指令
   */
  export function createInitEmptyMerkleTreeIx(
    merkleTree: PublicKey,
    authority: PublicKey,
    depthSizePair: ValidDepthSizePair
  ): TransactionInstruction
}
