/**
 * @file attempts.ts
 * @project SlothVault
 * @module Solana cNFT Attempt State
 * @description Owns cNFT capacity reservation and atomic failed or successful attempt transitions.
 * @logic Reserve tree capacity, persist the payer signature, settle confirmed assets, release safe failed reservations, and disable conflicting trees.
 * @dependencies database unit-of-work, server/prisma, admin Solana trees, solana-chain
 * @index_tags admin,solana,cnft,reservation,state-machine,recovery
 * @author holic512
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { unitOfWork } from '@/server/database/unit-of-work'
import { hasPrismaCode } from '@/server/services/admin-catalog'
import { TREE_STATUS } from '@/server/services/admin-solana-trees'
import {
  getAssetId,
  parseSolanaPublicKey,
} from '@/server/services/solana-chain'
import type { SolanaNetwork } from '@/server/services/system-config'

export const CNFT_STATUS = {
  FAILED: -1,
  MINTING: 0,
  NORMAL: 1,
} as const

const PREPARE_RESERVATION_TIMEOUT_MS = 15 * 60 * 1000

export async function reserveCnft(options: {
  projectId: number
  noteInfoId: number
  copyrightOwnerId: number
  ownerAddress: string
  name: string
  symbol: string
  description: string | null
  metadataUri: string | null
  network: SolanaNetwork
}) {
  return unitOfWork.execute(async (tx) => {
    const candidates = await tx.merkleTree.findMany({
      where: {
        network: options.network,
        status: TREE_STATUS.NORMAL,
        isDeleted: false,
        remainingCapacity: { gt: 0n },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 32,
    })
    let tree: (typeof candidates)[number] | null = null
    for (const candidate of candidates) {
      const reserved = await tx.merkleTree.updateMany({
        where: {
          id: candidate.id,
          network: options.network,
          status: TREE_STATUS.NORMAL,
          isDeleted: false,
          remainingCapacity: { gt: 0n },
        },
        data: {
          remainingCapacity: { decrement: 1n },
          capacityRevision: { increment: 1 },
          updatedAt: new Date(),
        },
      })
      if (reserved.count === 1) {
        tree = candidate
        break
      }
    }
    if (!tree) {
      throw new HttpError(`No available Merkle Tree exists on ${options.network}`, 400, 400)
    }

    const cnft = await tx.compressedNft.create({
      data: {
        merkleTreeId: tree.id,
        projectId: options.projectId,
        noteInfoId: options.noteInfoId,
        copyrightOwnerId: options.copyrightOwnerId,
        assetId: `pending_${randomUUID()}`,
        leafIndex: -1,
        name: options.name,
        symbol: options.symbol || null,
        description: options.description,
        metadataUri: options.metadataUri,
        ownerAddress: options.ownerAddress,
        prepareExpiresAt: new Date(Date.now() + PREPARE_RESERVATION_TIMEOUT_MS),
        capacityReserved: true,
        status: CNFT_STATUS.MINTING,
      },
    })
    return { tree, cnft }
  })
}

export async function markCnftFailed(cnftId: number) {
  try {
    await releaseFailedAttempt(cnftId)
  } catch (error) {
    console.error('[solana-cnft] Unable to mark failed prepare record', error)
  }
}

export function cnftResult(cnft: {
  id: number
  assetId: string
  mintTxSignature: string | null
  status: number
  leafIndex: number
}) {
  return {
    cnftId: cnft.id.toString(),
    assetId: cnft.assetId,
    txSignature: cnft.mintTxSignature,
    status: cnft.status,
    leafIndex: cnft.leafIndex,
  }
}

export async function persistSubmittedSignature(cnftId: number, signature: string) {
  try {
    const result = await prisma.compressedNft.updateMany({
      where: {
        id: cnftId,
        status: CNFT_STATUS.MINTING,
        OR: [{ mintTxSignature: null }, { mintTxSignature: signature }],
      },
      data: { mintTxSignature: signature, updatedAt: new Date() },
    })
    if (result.count === 1) return
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) {
      throw new HttpError('Transaction signature is already bound to another cNFT attempt', 409, 409)
    }
    throw error
  }

  const current = await prisma.compressedNft.findUnique({ where: { id: cnftId } })
  if (
    current?.status === CNFT_STATUS.NORMAL &&
    current.mintTxSignature === signature
  ) {
    return
  }
  throw new HttpError('cNFT attempt cannot accept this signed transaction', 409, 409)
}

export async function finalizeFailedAttempt(cnftId: number) {
  return releaseFailedAttempt(cnftId)
}

async function releaseFailedAttempt(cnftId: number) {
  return unitOfWork.execute(async (tx) => {
    const current = await tx.compressedNft.findUnique({ where: { id: cnftId } })
    if (!current || current.status !== CNFT_STATUS.MINTING) return current

    const released = await tx.compressedNft.updateMany({
      where: {
        id: cnftId,
        status: CNFT_STATUS.MINTING,
        capacityReserved: true,
      },
      data: {
        status: CNFT_STATUS.FAILED,
        capacityReserved: false,
        updatedAt: new Date(),
      },
    })
    if (released.count === 1) {
      let tree = await tx.merkleTree.update({
        where: { id: current.merkleTreeId },
        data: {
          capacityRevision: { increment: 1 },
          updatedAt: new Date(),
        },
      })
      if (tree.remainingCapacity < 0n || tree.remainingCapacity >= tree.maxCapacity) {
        await tx.merkleTree.update({
          where: { id: current.merkleTreeId },
          data: { status: TREE_STATUS.FAILED, updatedAt: new Date() },
        })
      } else {
        tree = await tx.merkleTree.update({
          where: { id: current.merkleTreeId },
          data: {
            remainingCapacity: { increment: 1n },
            updatedAt: new Date(),
          },
        })
        if (tree.status === TREE_STATUS.FULL && tree.remainingCapacity > 0n) {
          await tx.merkleTree.update({
            where: { id: current.merkleTreeId },
            data: { status: TREE_STATUS.NORMAL, updatedAt: new Date() },
          })
        }
      }
    } else {
      await tx.compressedNft.updateMany({
        where: { id: cnftId, status: CNFT_STATUS.MINTING },
        data: { status: CNFT_STATUS.FAILED, updatedAt: new Date() },
      })
    }
    return tx.compressedNft.findUnique({ where: { id: cnftId } })
  })
}

export async function finalizeSuccessfulAttempt(
  cnftId: number,
  signature: string,
  leafIndex: number,
) {
  const result = await unitOfWork.execute(async (tx) => {
    const [current, tree] = await Promise.all([
      tx.compressedNft.findUnique({ where: { id: cnftId } }),
      tx.compressedNft.findUnique({
        where: { id: cnftId },
        select: { merkleTree: true },
      }),
    ])
    if (!current) throw new HttpError('cNFT attempt not found', 404, 404)
    const treeRecord = tree?.merkleTree
    if (!treeRecord) throw new HttpError('cNFT attempt tree is missing', 409, 409)
    if (current.status === CNFT_STATUS.NORMAL) return { cnft: current, conflict: false }

    const treeAddress = parseSolanaPublicKey(treeRecord.treeAddress, 'treeAddress')
    const assetId = getAssetId(treeAddress, leafIndex).toBase58()
    const conflict = await tx.compressedNft.findUnique({ where: { assetId } })
    const nextTotalMinted = Math.max(treeRecord.totalMinted, leafIndex + 1)

    if (conflict && conflict.id !== current.id) {
      await tx.compressedNft.updateMany({
        where: {
          id: current.id,
          status: CNFT_STATUS.MINTING,
          capacityReserved: true,
        },
        data: {
          leafIndex,
          mintTxSignature: signature,
          capacityReserved: false,
          status: CNFT_STATUS.FAILED,
          updatedAt: new Date(),
        },
      })
      const conflictedTree = await tx.merkleTree.update({
        where: { id: treeRecord.id },
        data: {
          capacityRevision: { increment: 1 },
          status: TREE_STATUS.FAILED,
          updatedAt: new Date(),
        },
      })
      if (conflictedTree.totalMinted < nextTotalMinted) {
        await tx.merkleTree.update({
          where: { id: treeRecord.id },
          data: { totalMinted: nextTotalMinted, updatedAt: new Date() },
        })
      }
      const failed = await tx.compressedNft.findUniqueOrThrow({
        where: { id: current.id },
      })
      return { cnft: failed, conflict: true, assetId }
    }

    const claimed = await tx.compressedNft.updateMany({
      where: {
        id: current.id,
        status: CNFT_STATUS.MINTING,
        capacityReserved: true,
      },
      data: {
        assetId,
        leafIndex,
        mintTxSignature: signature,
        capacityReserved: false,
        status: CNFT_STATUS.NORMAL,
        updatedAt: new Date(),
      },
    })
    if (claimed.count === 0) {
      const settled = await tx.compressedNft.findUnique({ where: { id: current.id } })
      if (settled?.status === CNFT_STATUS.NORMAL) {
        return { cnft: settled, conflict: false }
      }
      throw new HttpError('cNFT attempt cannot be finalized', 409, 409)
    }

    let latestTree = await tx.merkleTree.update({
      where: { id: treeRecord.id },
      data: {
        capacityRevision: { increment: 1 },
        updatedAt: new Date(),
      },
    })
    if (latestTree.totalMinted < nextTotalMinted) {
      latestTree = await tx.merkleTree.update({
        where: { id: treeRecord.id },
        data: { totalMinted: nextTotalMinted, updatedAt: new Date() },
      })
    }
    if (latestTree.status !== TREE_STATUS.FAILED) {
      await tx.merkleTree.update({
        where: { id: treeRecord.id },
        data: {
          status: latestTree.remainingCapacity <= 0n ? TREE_STATUS.FULL : TREE_STATUS.NORMAL,
          updatedAt: new Date(),
        },
      })
    }
    const updated = await tx.compressedNft.findUniqueOrThrow({ where: { id: current.id } })
    return { cnft: updated, conflict: false }
  })

  if (result.conflict) {
    throw new HttpError(
      'Confirmed cNFT asset conflicts with an existing record; the tree was disabled for review',
      409,
      409,
      { cnftId: cnftId.toString(), txSignature: signature, assetId: result.assetId },
    )
  }
  return result.cnft
}
