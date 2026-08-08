/**
 * @file types.ts
 * @project SlothVault
 * @module Solana Administration
 * @description Defines the data contracts shared by the Solana administration panels and transaction workflow.
 * @logic Provide type-only boundaries for network selection, tree records, cNFT records, option lists, estimates, and transaction sessions.
 * @dependencies None
 * @index_tags admin,solana,types,merkle-tree,cnft,transactions
 * @author holic512
 */
export type SolanaNetwork = 'mainnet' | 'devnet'

export type TreeDto = {
  id: string
  name: string
  treeAddress: string
  treeAuthority: string
  creatorAddress: string
  maxDepth: number
  maxBufferSize: number
  canopyDepth: number
  network: SolanaNetwork
  totalMinted: number
  maxCapacity: string
  creationCost: string
  txSignature: string | null
  priority: number
  status: number
  createdAt: string
  updatedAt: string
  mintedCount: number
}

export type CnftDto = {
  id: string
  projectId: string
  projectName: string | null
  projectAvatar: string | null
  noteInfoId: string | null
  noteTitle: string | null
  copyrightOwner: string | null
  assetId: string
  leafIndex: number
  name: string
  symbol: string | null
  metadataUri: string | null
  ownerAddress: string
  mintTxSignature: string | null
  status: number
  createdAt: string
  updatedAt: string
  merkleTree: { name: string; treeAddress: string; network: SolanaNetwork }
}

export type ProjectOption = { id: string; projectName: string }
export type NoteOption = { id: string; noteTitle: string }

export type EstimatePreset = {
  label: string
  maxDepth: number
  maxBufferSize: number
  canopyDepth: number
  capacity: number
  spaceBytes: number
  rentLamports: number
  rentSol: string
}

export type PrepareTransaction = {
  transactionBase64: string
  sessionId: string
  expiresAt: number
}

export type SubmitTransaction = {
  status: number
  txSignature: string | null
}
