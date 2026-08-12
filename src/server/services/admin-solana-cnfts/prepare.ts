/**
 * @file prepare.ts
 * @project SlothVault
 * @module Solana cNFT Preparation
 * @description Validates an article copyright request, reserves capacity, prepares its mint transaction, and seals the submission session.
 * @logic Bind published content and the administrator owner, optionally upload metadata, build the unsigned transaction, and compensate failed preparation.
 * @dependencies server/prisma, solana-chain, solana-session, Filebase, cNFT attempts and metadata
 * @index_tags admin,solana,cnft,prepare,transaction,copyright
 * @author holic512
 */
import 'server-only'

import { Keypair } from '@solana/web3.js'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { RELEASE_MANIFEST_VERSION } from '@/server/services/project-version-release'
import {
  isFilebaseConfigured,
  type FilebaseUploadResult,
} from '@/server/services/filebase'
import {
  BUBBLEGUM_PROGRAM_ID,
  buildMintTransaction,
  getSolanaConnection,
  isLikelyRpcError,
  parseSolanaPublicKey,
  serializePreparedTransaction,
  transactionMessageHash,
} from '@/server/services/solana-chain'
import {
  decryptTreeAuthorityKey,
  sealSolanaSession,
  secretKeyFromBase64,
} from '@/server/services/solana-session'
import {
  getSolanaNetwork,
  type SolanaNetwork,
} from '@/server/services/system-config'

import {
  markCnftFailed,
  reserveCnft,
} from './attempts'
import {
  cleanupFilebaseUploads,
  uploadProjectAvatarMetadata,
} from './metadata'
import { reconcilePendingCnfts } from './reconciliation'

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
          publishedAt: { not: null },
          releaseId: { not: null },
          releaseHash: { not: null },
          manifestVersion: RELEASE_MANIFEST_VERSION,
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
        where: { isDeleted: false, status: 1, isPrimary: true },
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
