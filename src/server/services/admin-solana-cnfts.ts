/**
 * @file admin-solana-cnfts.ts
 * @project SlothVault
 * @module Solana cNFT Administration
 * @description Implements article copyright cNFT reservation, optional Filebase metadata, wallet prepare/submit, chain reconciliation, listing, and failure recovery.
 * @logic Bind every new cNFT to a published article and administrator copyright owner, reserve tree capacity atomically, persist the deterministic payer signature, derive the final asset only from confirmed chain events, and never use ownership as a reading gate.
 * @dependencies Prisma article/User/MerkleTree/CompressedNft models, solana-chain, solana-session, Filebase, Sharp, admin file storage
 * @index_tags admin,solana,cnft,copyright,article,reconciliation,transaction,filebase
 * @author holic512
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import type { Prisma } from '@generated/prisma-postgresql/client'
import { Keypair } from '@solana/web3.js'
import sharp from 'sharp'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { unitOfWork } from '@/server/database/unit-of-work'
import { hasPrismaCode } from '@/server/services/admin-catalog'
import {
  inspectPublicUpload,
  readPublicUpload,
} from '@/server/services/admin-files'
import { TREE_STATUS } from '@/server/services/admin-solana-trees'
import {
  deleteFilebaseObject,
  isFilebaseConfigured,
  uploadImageToFilebase,
  uploadMetadataToFilebase,
  type FilebaseUploadResult,
} from '@/server/services/filebase'
import {
  BUBBLEGUM_PROGRAM_ID,
  assertPreparedTransaction,
  buildMintTransaction,
  getAssetId,
  getSolanaConnection,
  inspectMintTransaction,
  isLikelyRpcError,
  parseSignedTransaction,
  parseSolanaPublicKey,
  sendAndConfirmPreparedTransaction,
  serializePreparedTransaction,
  signedTransactionSignature,
  transactionMessageHash,
} from '@/server/services/solana-chain'
import {
  decryptTreeAuthorityKey,
  openSolanaSession,
  sealSolanaSession,
  secretKeyFromBase64,
} from '@/server/services/solana-session'
import {
  getSolanaNetwork,
  type SolanaNetwork,
} from '@/server/services/system-config'

export const CNFT_STATUS = {
  FAILED: -1,
  MINTING: 0,
  NORMAL: 1,
} as const

const PREPARE_RESERVATION_TIMEOUT_MS = 15 * 60 * 1000

type PrepareCnftOptions = {
  projectId: number
  noteInfoId: number
  copyrightOwnerId: number
  ownerAddress: string
  name: string
  symbol?: string
  description?: string
  useProjectAvatar: boolean
  metadataUri?: string
  payerAddress: string
  network: SolanaNetwork
}

function throwSolanaOperationError(error: unknown, operation: string): never {
  if (error instanceof HttpError) throw error
  console.error(`[solana-cnft] ${operation} failed`, error)
  if (isLikelyRpcError(error)) throw new HttpError('Solana RPC is unavailable', 503, 503)
  throw new HttpError(`Unable to ${operation}`, 500, 500)
}

function normalizeMetadataUri(value: string | undefined) {
  const uri = value?.trim() || ''
  if (!uri) return ''
  if (Buffer.byteLength(uri, 'utf8') > 200) {
    throw new HttpError('metadataUri exceeds the 200-byte on-chain limit', 400, 400)
  }
  if (uri.startsWith('ipfs://')) {
    const ipfsPath = uri.slice('ipfs://'.length)
    if (!ipfsPath || /[\s\\]/.test(ipfsPath)) {
      throw new HttpError('metadataUri is not a valid IPFS URI', 400, 400)
    }
    return uri
  }
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    throw new HttpError('metadataUri must be an IPFS or HTTP(S) URI', 400, 400)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new HttpError('metadataUri must be an IPFS or HTTP(S) URI', 400, 400)
  }
  return parsed.toString()
}

function validateOnChainMetadata(name: string, symbol: string, uri: string) {
  const nameBytes = Buffer.byteLength(name, 'utf8')
  const symbolBytes = Buffer.byteLength(symbol, 'utf8')
  if (nameBytes === 0 || nameBytes > 32) {
    throw new HttpError(`name must be between 1 and 32 UTF-8 bytes (received ${nameBytes})`, 400, 400)
  }
  if (symbolBytes > 10) {
    throw new HttpError(`symbol exceeds the 10-byte on-chain limit (received ${symbolBytes})`, 400, 400)
  }
  if (Buffer.byteLength(uri, 'utf8') > 200) {
    throw new HttpError('metadata URI exceeds the 200-byte on-chain limit', 400, 400)
  }
}

async function reserveCnft(options: {
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

async function markCnftFailed(cnftId: number) {
  try {
    await releaseFailedAttempt(cnftId)
  } catch (error) {
    console.error('[solana-cnft] Unable to mark failed prepare record', error)
  }
}

type PendingCnft = Prisma.CompressedNftGetPayload<{
  include: { merkleTree: true }
}>

function cnftResult(cnft: {
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

async function persistSubmittedSignature(cnftId: number, signature: string) {
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

async function finalizeFailedAttempt(cnftId: number) {
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

async function finalizeSuccessfulAttempt(
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

async function reconcileCnftAttempt(current: PendingCnft) {
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

async function reconcilePendingCnfts(network?: SolanaNetwork) {
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

async function cleanupFilebaseUploads(keys: string[]) {
  await Promise.all(
    keys.map(async (key) => {
      try {
        await deleteFilebaseObject(key)
      } catch (error) {
        console.error('[solana-cnft] Unable to compensate Filebase upload', error)
      }
    }),
  )
}

function avatarSegments(avatar: string) {
  const normalized = avatar.startsWith('/') ? avatar.slice(1) : avatar
  if (!normalized.startsWith('uploads/')) return null
  const segments = normalized.slice('uploads/'.length).split('/')
  return segments.length > 0 ? segments : null
}

async function uploadProjectAvatarMetadata(options: {
  avatar: string
  name: string
  symbol: string
  description: string
  creatorAddress: string
}) {
  const segments = avatarSegments(options.avatar)
  if (!segments) return null
  const inspected = await inspectPublicUpload(segments)
  if (inspected.stats.size > 5 * 1024 * 1024) {
    throw new HttpError('Project avatar is too large for cNFT metadata', 400, 400)
  }
  const original = await readPublicUpload(inspected.absolutePath)
  const image = await sharp(original, {
    failOn: 'warning',
    limitInputPixels: 40_000_000,
  })
    .rotate()
    .flatten({ background: { r: 15, g: 23, b: 42 } })
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85, effort: 4 })
    .toBuffer()

  let imageUpload: FilebaseUploadResult | null = null
  try {
    imageUpload = await uploadImageToFilebase(image, 'webp', 'image/webp')
    const metadata = {
      name: options.name,
      symbol: options.symbol,
      description: options.description,
      image: imageUpload.ipfsUri,
      properties: {
        category: 'image',
        files: [{ uri: imageUpload.ipfsUri, type: 'image/webp' }],
        creators: [{ address: options.creatorAddress, share: 100 }],
      },
    }
    const metadataUpload = await uploadMetadataToFilebase(metadata)
    return { imageUpload, metadataUpload, filePath: `uploads/${segments.join('/')}` }
  } catch (error) {
    if (imageUpload) await cleanupFilebaseUploads([imageUpload.key])
    throw error
  }
}

export async function prepareCnft(options: PrepareCnftOptions) {
  const configuredNetwork = await getSolanaNetwork()
  if (configuredNetwork !== options.network) {
    throw new HttpError('Solana network changed; refresh and prepare again', 409, 409)
  }
  const payer = parseSolanaPublicKey(options.payerAddress, 'payerAddress')
  const owner = parseSolanaPublicKey(options.ownerAddress, 'ownerAddress')
  const name = options.name.trim()
  const symbol = options.symbol?.trim() || ''
  const description = options.description?.trim() || ''
  const inputMetadataUri = normalizeMetadataUri(options.metadataUri)
  validateOnChainMetadata(name, symbol, inputMetadataUri)

  const article = await prisma.noteInfo.findFirst({
    where: {
      id: options.noteInfoId,
      isDeleted: false,
      status: 1,
      category: {
        isDeleted: false,
        status: 1,
        projectVersion: {
          isDeleted: false,
          status: 1,
          project: { id: options.projectId, isDeleted: false, status: 1 },
        },
      },
    },
    select: {
      id: true,
      noteTitle: true,
      category: {
        select: {
          projectVersion: {
            select: { project: { select: { id: true, projectName: true, avatar: true } } },
          },
        },
      },
      contents: {
        where: { isDeleted: false, status: 1 },
        select: { id: true },
        take: 1,
      },
    },
  })
  if (!article || article.contents.length === 0) {
    throw new HttpError('Published article not found', 404, 404)
  }
  const project = article.category.projectVersion.project

  await reconcilePendingCnfts(options.network)

  let reserved: Awaited<ReturnType<typeof reserveCnft>> | null = null
  const uploadedKeys: string[] = []
  try {
    reserved = await reserveCnft({
      projectId: project.id,
      noteInfoId: article.id,
      copyrightOwnerId: options.copyrightOwnerId,
      ownerAddress: owner.toBase58(),
      name,
      symbol,
      description: description || null,
      metadataUri: inputMetadataUri || null,
      network: options.network,
    })

    const decrypted = decryptTreeAuthorityKey(reserved.tree.encryptedKey)
    const treeAuthority = Keypair.fromSecretKey(secretKeyFromBase64(decrypted))
    if (treeAuthority.publicKey.toBase58() !== reserved.tree.treeAuthority) {
      throw new HttpError('Decrypted tree authority does not match the Merkle Tree record', 500, 500)
    }

    let finalMetadataUri = inputMetadataUri
    let imageCid: string | null = null
    let metadataCid: string | null = null
    let originalImageId: number | null = null
    let imageResult: FilebaseUploadResult | null = null
    let metadataResult: FilebaseUploadResult | null = null

    if (
      !finalMetadataUri &&
      options.useProjectAvatar &&
      project.avatar &&
      (await isFilebaseConfigured())
    ) {
      try {
        const uploaded = await uploadProjectAvatarMetadata({
          avatar: project.avatar,
          name,
          symbol,
          description: description || `${article.noteTitle} · ${project.projectName}`,
          creatorAddress: treeAuthority.publicKey.toBase58(),
        })
        if (uploaded) {
          imageResult = uploaded.imageUpload
          metadataResult = uploaded.metadataUpload
          uploadedKeys.push(imageResult.key, metadataResult.key)
          imageCid = imageResult.cid
          metadataCid = metadataResult.cid
          finalMetadataUri = metadataResult.ipfsUri
          const originalImage = await prisma.fileManagement.findFirst({
            where: { filePath: uploaded.filePath, status: 1 },
            select: { id: true },
          })
          originalImageId = originalImage?.id ?? null
        }
      } catch {
        console.warn('[solana-cnft] Optional project avatar metadata was skipped')
        await cleanupFilebaseUploads(uploadedKeys.splice(0))
        imageResult = null
        metadataResult = null
        imageCid = null
        metadataCid = null
        finalMetadataUri = ''
      }
    }
    validateOnChainMetadata(name, symbol, finalMetadataUri)

    const connection = await getSolanaConnection(options.network)
    const treeAddress = parseSolanaPublicKey(reserved.tree.treeAddress, 'treeAddress')
    const prepared = await buildMintTransaction({
      connection,
      payer,
      treeAuthority,
      merkleTree: treeAddress,
      owner,
      metadata: {
        name,
        symbol,
        uri: finalMetadataUri,
        sellerFeeBasisPoints: 0,
        creators: [
          {
            address: treeAuthority.publicKey,
            verified: true,
            share: 100,
          },
        ],
        isMutable: true,
        primarySaleHappened: false,
      },
    })

    const session = sealSolanaSession({
      kind: 'mint',
      merkleTreeId: reserved.tree.id.toString(),
      cnftId: reserved.cnft.id.toString(),
      noteInfoId: article.id.toString(),
      copyrightOwnerId: options.copyrightOwnerId.toString(),
      leafIndex: reserved.cnft.leafIndex,
      ownerAddress: owner.toBase58(),
      treeAddress: reserved.tree.treeAddress,
      treeAuthority: treeAuthority.publicKey.toBase58(),
      network: options.network,
      payerAddress: payer.toBase58(),
      messageHash: transactionMessageHash(prepared.transaction),
      recentBlockhash: prepared.blockhash,
      lastValidBlockHeight: prepared.lastValidBlockHeight,
      programIds: [BUBBLEGUM_PROGRAM_ID.toBase58()],
    })

    await prisma.compressedNft.update({
      where: { id: reserved.cnft.id },
      data: {
        metadataUri: finalMetadataUri || null,
        imageCid,
        metadataCid,
        originalImageId,
        prepareExpiresAt: new Date(session.expiresAt),
        lastValidBlockHeight: BigInt(prepared.lastValidBlockHeight),
        updatedAt: new Date(),
      },
    })

    return {
      transactionBase64: serializePreparedTransaction(prepared.transaction),
      sessionId: session.token,
      expiresAt: session.expiresAt,
      merkleTree: {
        id: reserved.tree.id.toString(),
        address: reserved.tree.treeAddress,
        name: reserved.tree.name,
      },
      leafIndex: reserved.cnft.leafIndex,
      cnftId: reserved.cnft.id.toString(),
      ...(imageResult
        ? {
            image: {
              cid: imageResult.cid,
              ipfsUri: imageResult.ipfsUri,
              gatewayUrl: imageResult.gatewayUrl,
            },
          }
        : {}),
      ...(metadataResult
        ? {
            metadata: {
              cid: metadataResult.cid,
              ipfsUri: metadataResult.ipfsUri,
              gatewayUrl: metadataResult.gatewayUrl,
            },
          }
        : {}),
    }
  } catch (error) {
    if (reserved) await markCnftFailed(reserved.cnft.id)
    if (uploadedKeys.length) await cleanupFilebaseUploads(uploadedKeys)
    throwSolanaOperationError(error, 'prepare cNFT transaction')
  }
}

export async function submitCnft(options: {
  sessionId: string
  signedTransactionBase64: string
}) {
  const session = openSolanaSession(options.sessionId, 'mint')
  const cnftId = Number(session.cnftId)
  const treeId = Number(session.merkleTreeId)
  const noteInfoId = Number(session.noteInfoId)
  const copyrightOwnerId = Number(session.copyrightOwnerId)
  if (
    !Number.isSafeInteger(cnftId) ||
    !Number.isSafeInteger(treeId) ||
    !Number.isSafeInteger(noteInfoId) ||
    !Number.isSafeInteger(copyrightOwnerId)
  ) {
    throw new HttpError('cNFT prepare session contains an invalid database identifier', 400, 400)
  }
  const current = await prisma.compressedNft.findUnique({
    where: { id: cnftId },
    include: { merkleTree: true },
  })
  if (!current) throw new HttpError('cNFT prepare record not found', 404, 404)
  if (
    current.merkleTreeId !== treeId ||
    current.merkleTree.treeAddress !== session.treeAddress ||
    current.ownerAddress !== session.ownerAddress ||
    current.noteInfoId !== noteInfoId ||
    current.copyrightOwnerId !== copyrightOwnerId
  ) {
    throw new HttpError('cNFT prepare record does not match the session', 409, 409)
  }
  if (current.status === CNFT_STATUS.NORMAL && current.mintTxSignature) {
    return {
      data: cnftResult(current),
      message: 'cNFT transaction was already submitted',
    }
  }
  if (current.status === CNFT_STATUS.FAILED) {
    return {
      data: cnftResult(current),
      message: 'cNFT transaction is already marked as failed',
    }
  }

  const transaction = parseSignedTransaction(options.signedTransactionBase64)
  assertPreparedTransaction(transaction, session)
  const expectedSignature = signedTransactionSignature(transaction)
  await persistSubmittedSignature(cnftId, expectedSignature)

  let submitted: Awaited<ReturnType<typeof sendAndConfirmPreparedTransaction>>
  try {
    const connection = await getSolanaConnection(session.network)
    submitted = await sendAndConfirmPreparedTransaction({
      connection,
      transaction,
      blockhash: session.recentBlockhash,
      lastValidBlockHeight: session.lastValidBlockHeight,
    })
  } catch (error) {
    console.error('[solana-cnft] cNFT submission outcome is unknown', error)
    throw new HttpError(
      isLikelyRpcError(error)
        ? 'Solana RPC is unavailable; the cNFT attempt will be reconciled by signature'
        : 'Unable to submit cNFT transaction; the attempt will be reconciled by signature',
      isLikelyRpcError(error) ? 503 : 500,
      isLikelyRpcError(error) ? 503 : 500,
      { cnftId: cnftId.toString(), txSignature: expectedSignature },
    )
  }
  if (submitted.signature !== expectedSignature) {
    throw new HttpError(
      'RPC returned an unexpected transaction signature; reconciliation is required',
      502,
      502,
      { cnftId: cnftId.toString(), txSignature: expectedSignature },
    )
  }

  let reconciled: Awaited<ReturnType<typeof reconcileCnftAttempt>>
  if (submitted.result === 'failed') {
    reconciled = (await finalizeFailedAttempt(cnftId)) ?? current
  } else {
    const pending = await prisma.compressedNft.findUnique({
      where: { id: cnftId },
      include: { merkleTree: true },
    })
    if (!pending) throw new HttpError('cNFT attempt not found after submission', 409, 409)
    reconciled = await reconcileCnftAttempt(pending)
  }

  return {
    data: cnftResult(reconciled),
    message:
      reconciled.status === CNFT_STATUS.NORMAL
        ? 'cNFT minted successfully'
        : reconciled.status === CNFT_STATUS.FAILED
          ? 'cNFT transaction failed'
          : 'cNFT transaction submitted and is awaiting chain-event reconciliation',
  }
}

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
