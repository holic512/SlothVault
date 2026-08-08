/**
 * @file records.ts
 * @project SlothVault
 * @module Solana cNFT Records
 * @description Lists cNFT administration records with related content labels and deletes only reconciled failed attempts.
 * @logic Reconcile pending attempts before reads or deletion, apply stable filters and DTO mapping, and protect successfully minted records.
 * @dependencies server/prisma, solana cNFT attempt state and reconciliation
 * @index_tags admin,solana,cnft,list,delete,records
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import type { SolanaNetwork } from '@/server/services/system-config'

import { CNFT_STATUS } from './attempts'
import {
  reconcileCnftAttempt,
  reconcilePendingCnfts,
} from './reconciliation'

export async function listCnfts(options: {
  projectId?: number
  noteInfoId?: number
  merkleTreeId?: number
  ownerAddress?: string
  status?: number
  network?: SolanaNetwork
  page: number
  pageSize: number
}) {
  await reconcilePendingCnfts(options.network)
  const where: Prisma.CompressedNftWhereInput = {
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.noteInfoId ? { noteInfoId: options.noteInfoId } : {}),
    ...(options.merkleTreeId ? { merkleTreeId: options.merkleTreeId } : {}),
    ...(options.ownerAddress
      ? { ownerAddress: { contains: options.ownerAddress } }
      : {}),
    ...(options.status !== undefined ? { status: options.status } : {}),
    merkleTree: {
      isDeleted: false,
      ...(options.network ? { network: options.network } : {}),
    },
  }
  const skip = (options.page - 1) * options.pageSize
  const [cnfts, total] = await Promise.all([
    prisma.compressedNft.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: options.pageSize,
      include: {
        merkleTree: {
          select: { name: true, treeAddress: true, network: true },
        },
      },
    }),
    prisma.compressedNft.count({ where }),
  ])
  const projectIds = [...new Set(cnfts.map((cnft) => cnft.projectId))]
  const noteInfoIds = [...new Set(cnfts.flatMap((cnft) => cnft.noteInfoId ? [cnft.noteInfoId] : []))]
  const copyrightOwnerIds = [...new Set(cnfts.flatMap((cnft) => cnft.copyrightOwnerId ? [cnft.copyrightOwnerId] : []))]
  const projects = projectIds.length
    ? await prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, projectName: true, avatar: true },
      })
    : []
  const projectMap = new Map(projects.map((project) => [project.id.toString(), project]))
  const [notes, copyrightOwners] = await Promise.all([
    noteInfoIds.length
      ? prisma.noteInfo.findMany({
          where: { id: { in: noteInfoIds } },
          select: { id: true, noteTitle: true },
        })
      : [],
    copyrightOwnerIds.length
      ? prisma.user.findMany({
          where: { id: { in: copyrightOwnerIds } },
          select: { id: true, username: true, displayName: true },
        })
      : [],
  ])
  const noteMap = new Map(notes.map((note) => [note.id, note.noteTitle]))
  const copyrightOwnerMap = new Map(
    copyrightOwners.map((user) => [user.id, user.displayName || user.username]),
  )
  return {
    list: cnfts.map((cnft) => {
      const project = projectMap.get(cnft.projectId.toString())
      return {
        id: cnft.id.toString(),
        projectId: cnft.projectId.toString(),
        projectName: project?.projectName ?? null,
        projectAvatar: project?.avatar ?? null,
        noteInfoId: cnft.noteInfoId?.toString() ?? null,
        noteTitle: cnft.noteInfoId ? noteMap.get(cnft.noteInfoId) ?? null : null,
        copyrightOwnerId: cnft.copyrightOwnerId?.toString() ?? null,
        copyrightOwner: cnft.copyrightOwnerId
          ? copyrightOwnerMap.get(cnft.copyrightOwnerId) ?? null
          : null,
        assetId: cnft.assetId,
        leafIndex: cnft.leafIndex,
        name: cnft.name,
        symbol: cnft.symbol,
        description: cnft.description,
        metadataUri: cnft.metadataUri,
        imageCid: cnft.imageCid,
        metadataCid: cnft.metadataCid,
        ownerAddress: cnft.ownerAddress,
        mintTxSignature: cnft.mintTxSignature,
        prepareExpiresAt: cnft.prepareExpiresAt,
        lastValidBlockHeight: cnft.lastValidBlockHeight?.toString() ?? null,
        status: cnft.status,
        createdAt: cnft.createdAt,
        updatedAt: cnft.updatedAt,
        merkleTree: cnft.merkleTree,
      }
    }),
    total,
    page: options.page,
    pageSize: options.pageSize,
  }
}

export async function deleteCnft(id: number) {
  let cnft = await prisma.compressedNft.findUnique({
    where: { id },
    include: { merkleTree: true },
  })
  if (!cnft) throw new HttpError('cNFT record not found', 404, 404)
  if (cnft.status === CNFT_STATUS.MINTING) {
    await reconcileCnftAttempt(cnft)
    cnft = await prisma.compressedNft.findUnique({
      where: { id },
      include: { merkleTree: true },
    })
    if (!cnft) throw new HttpError('cNFT record not found', 404, 404)
  }
  if (cnft.status === CNFT_STATUS.NORMAL) {
    throw new HttpError('A successfully minted cNFT record cannot be deleted', 400, 400)
  }
  if (cnft.status !== CNFT_STATUS.FAILED) {
    throw new HttpError(
      'A prepared or submitted cNFT attempt cannot be deleted before reconciliation',
      409,
      409,
    )
  }

  await prisma.compressedNft.delete({ where: { id: cnft.id } })
  return { id: cnft.id.toString(), deleted: true }
}
