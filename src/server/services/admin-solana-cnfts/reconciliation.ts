/**
 * @file reconciliation.ts
 * @project SlothVault
 * @module Solana cNFT Reconciliation
 * @description Reconciles pending cNFT attempts against confirmed, failed, expired, or unseen chain transactions.
 * @logic Inspect stored signatures and block height, then delegate atomic success or failure transitions while leaving uncertain attempts pending.
 * @dependencies server/prisma, solana-chain, cNFT attempt state
 * @index_tags admin,solana,cnft,reconciliation,signature,block-height
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { prisma } from '@/server/prisma'
import {
  getSolanaConnection,
  inspectMintTransaction,
  parseSolanaPublicKey,
} from '@/server/services/solana-chain'
import type { SolanaNetwork } from '@/server/services/system-config'

import {
  CNFT_STATUS,
  finalizeFailedAttempt,
  finalizeSuccessfulAttempt,
} from './attempts'

export type PendingCnft = Prisma.CompressedNftGetPayload<{
  include: { merkleTree: true }
}>

export async function reconcileCnftAttempt(current: PendingCnft) {
  if (current.status !== CNFT_STATUS.MINTING) return current

  if (!current.mintTxSignature) {
    if (current.prepareExpiresAt && current.prepareExpiresAt.getTime() <= Date.now()) {
      return (await finalizeFailedAttempt(current.id)) ?? current
    }
    return current
  }

  const connection = await getSolanaConnection(current.merkleTree.network as SolanaNetwork)
  const inspection = await inspectMintTransaction(
    connection,
    current.mintTxSignature,
    parseSolanaPublicKey(current.merkleTree.treeAddress, 'treeAddress'),
  )
  if (inspection.result === 'confirmed') {
    return finalizeSuccessfulAttempt(
      current.id,
      current.mintTxSignature,
      inspection.leafIndex,
    )
  }
  if (inspection.result === 'failed') {
    return (await finalizeFailedAttempt(current.id)) ?? current
  }
  if (
    inspection.result === 'pending' &&
    !inspection.seenOnChain &&
    current.lastValidBlockHeight !== null
  ) {
    const blockHeight = await connection.getBlockHeight('confirmed')
    if (BigInt(blockHeight) > current.lastValidBlockHeight) {
      return (await finalizeFailedAttempt(current.id)) ?? current
    }
  }
  if (
    inspection.result === 'pending' &&
    !inspection.seenOnChain &&
    current.lastValidBlockHeight === null &&
    current.prepareExpiresAt &&
    current.prepareExpiresAt.getTime() <= Date.now()
  ) {
    return (await finalizeFailedAttempt(current.id)) ?? current
  }
  return current
}

export async function reconcilePendingCnfts(network?: SolanaNetwork) {
  const attempts = await prisma.compressedNft.findMany({
    where: {
      status: CNFT_STATUS.MINTING,
      ...(network ? { merkleTree: { network, isDeleted: false } } : {}),
    },
    include: { merkleTree: true },
    orderBy: { updatedAt: 'asc' },
    take: 25,
  })
  await Promise.all(
    attempts.map(async (attempt) => {
      try {
        await reconcileCnftAttempt(attempt)
      } catch (error) {
        console.warn(`[solana-cnft] Unable to reconcile attempt ${attempt.id}`, error)
      }
    }),
  )
}
