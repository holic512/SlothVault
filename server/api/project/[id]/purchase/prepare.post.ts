import { Keypair, PublicKey } from '@solana/web3.js'
import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'

import { buildProjectPurchaseTransaction, createDefaultCnftMetadata } from '~~/server/utils/bubblegum'
import { verifyProjectAccess } from '~~/server/utils/cnftAuth'
import { getSolanaReceiverAddress } from '~~/server/utils/configCache'
import { decryptPrivateKey, stringToSecretKey } from '~~/server/utils/crypto'
import { prisma } from '~~/server/utils/prisma'
import { expirePreparedPurchaseIfNeeded } from '~~/server/utils/projectPurchaseLifecycle'
import {
  isPurchaseEnabled,
  lamportsToSolDisplay,
  PurchaseStatus,
} from '~~/server/utils/projectPurchase'
import { createProjectPurchaseSession } from '~~/server/utils/projectPurchaseSession'
import { ok, fail } from '~~/server/utils/response'
import { getActiveNetwork, getConnection, isValidSolanaAddress } from '~~/server/utils/solana'
import { selectAvailableTree } from '~~/server/utils/treeSelector'

interface PreparePurchaseRequest {
  buyerWalletAddress?: string
}

function buildPurchaseCnftName(projectName: string): string {
  let candidate = `${projectName} Access`

  while (Buffer.from(candidate, 'utf8').length > 32 && candidate.length > 1) {
    candidate = candidate.slice(0, -1)
  }

  return candidate
}

export default defineEventHandler(async (event) => {
  const projectIdRaw = getRouterParam(event, 'id')
  if (!projectIdRaw) {
    setResponseStatus(event, 400)
    return fail('Missing project id', 400)
  }

  let projectId: bigint
  try {
    projectId = BigInt(projectIdRaw)
  } catch {
    setResponseStatus(event, 400)
    return fail('Invalid project id', 400)
  }

  const body = await readBody<PreparePurchaseRequest>(event)
  const buyerWalletAddress = body?.buyerWalletAddress?.trim()

  if (!buyerWalletAddress || !isValidSolanaAddress(buyerWalletAddress)) {
    setResponseStatus(event, 400)
    return fail('Invalid buyer wallet address', 400)
  }

  const network = await getActiveNetwork()

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      isDeleted: false,
      status: 1,
    },
    select: {
      id: true,
      projectName: true,
      requireAuth: true,
      accessPriceLamports: true,
    },
  })

  if (!project) {
    setResponseStatus(event, 404)
    return fail('Project not found', 404)
  }

  if (!project.requireAuth) {
    setResponseStatus(event, 400)
    return fail('This project does not require purchase-based access', 400)
  }

  if (!isPurchaseEnabled(project.accessPriceLamports)) {
    setResponseStatus(event, 400)
    return fail('This project is not available for purchase', 400)
  }

  const receiverWalletAddress = (await getSolanaReceiverAddress(network)).trim()
  if (!receiverWalletAddress || !isValidSolanaAddress(receiverWalletAddress)) {
    setResponseStatus(event, 400)
    return fail('Receiver wallet is not configured for the active network', 400)
  }

  const pendingRecords = await prisma.projectPurchaseRecord.findMany({
    where: {
      projectId,
      buyerWalletAddress,
      network,
      status: {
        in: [PurchaseStatus.PREPARED, PurchaseStatus.SUBMITTED],
      },
    },
    select: {
      id: true,
      status: true,
    },
  })

  for (const record of pendingRecords) {
    if (record.status === PurchaseStatus.PREPARED) {
      await expirePreparedPurchaseIfNeeded(record.id)
    }
  }

  const activePurchaseCount = await prisma.projectPurchaseRecord.count({
    where: {
      projectId,
      buyerWalletAddress,
      network,
      status: {
        in: [PurchaseStatus.PREPARED, PurchaseStatus.SUBMITTED, PurchaseStatus.COMPLETED],
      },
    },
  })

  if (activePurchaseCount > 0) {
    const existingAccess = await verifyProjectAccess(projectId, buyerWalletAddress, { network })
    if (existingAccess.hasAccess) {
      setResponseStatus(event, 400)
      return fail('You already have access to this project', 400)
    }

    const pendingAfterExpire = await prisma.projectPurchaseRecord.count({
      where: {
        projectId,
        buyerWalletAddress,
        network,
        status: {
          in: [PurchaseStatus.PREPARED, PurchaseStatus.SUBMITTED],
        },
      },
    })

    if (pendingAfterExpire > 0) {
      setResponseStatus(event, 400)
      return fail('There is already an in-progress purchase for this project', 400)
    }
  }

  const availableTree = await selectAvailableTree(network)
  if (!availableTree) {
    setResponseStatus(event, 400)
    return fail(`No available Merkle Tree for ${network}`, 400)
  }

  let treeAuthorityKeypair: Keypair
  try {
    const decryptedKey = decryptPrivateKey(availableTree.encryptedKey)
    const secretKey = stringToSecretKey(decryptedKey)
    treeAuthorityKeypair = Keypair.fromSecretKey(secretKey)
  } catch (error: any) {
    console.error('[project-purchase/prepare] Failed to decrypt tree key:', error)
    setResponseStatus(event, 500)
    return fail('Failed to decrypt tree authority key', 500)
  }

  if (treeAuthorityKeypair.publicKey.toBase58() !== availableTree.treeAuthority) {
    setResponseStatus(event, 500)
    return fail('Tree authority mismatch', 500)
  }

  const leafIndex = availableTree.totalMinted
  const priceLamports = project.accessPriceLamports as bigint
  const cnftName = buildPurchaseCnftName(project.projectName)

  let transaction
  try {
    const connection = await getConnection(network)
    const metadata = createDefaultCnftMetadata(
      cnftName,
      'SLV',
      '',
      treeAuthorityKeypair.publicKey
    )

    transaction = (
      await buildProjectPurchaseTransaction(
        connection,
        new PublicKey(buyerWalletAddress),
        new PublicKey(receiverWalletAddress),
        treeAuthorityKeypair,
        new PublicKey(availableTree.treeAddress),
        metadata,
        leafIndex,
        priceLamports
      )
    ).transaction
  } catch (error: any) {
    console.error('[project-purchase/prepare] Failed to build transaction:', error)
    setResponseStatus(event, 500)
    return fail(`Failed to build purchase transaction: ${error.message}`, 500)
  }

  try {
    transaction.partialSign(treeAuthorityKeypair)
  } catch (error: any) {
    console.error('[project-purchase/prepare] Failed to partially sign transaction:', error)
    setResponseStatus(event, 500)
    return fail('Failed to sign purchase transaction', 500)
  }

  let purchaseRecordId: bigint
  let cnftId: bigint
  try {
    const result = await prisma.$transaction(async (tx) => {
      const purchaseRecord = await tx.projectPurchaseRecord.create({
        data: {
          projectId,
          buyerWalletAddress,
          receiverWalletAddress,
          network,
          priceLamports,
          status: PurchaseStatus.PREPARED,
        },
      })

      const cnft = await tx.compressedNft.create({
        data: {
          merkleTreeId: availableTree.id,
          projectId,
          assetId: `pending_${Date.now()}_${leafIndex}`,
          leafIndex,
          name: cnftName,
          symbol: 'SLV',
          description: `${project.projectName} project access credential`,
          ownerAddress: buyerWalletAddress,
          grantSource: 'purchase',
          purchaseRecordId: purchaseRecord.id,
          status: 0,
        },
      })

      await tx.projectPurchaseRecord.update({
        where: { id: purchaseRecord.id },
        data: {
          cnftId: cnft.id,
          updatedAt: new Date(),
        },
      })

      await tx.merkleTree.update({
        where: { id: availableTree.id },
        data: {
          totalMinted: leafIndex + 1,
          updatedAt: new Date(),
        },
      })

      return {
        purchaseRecordId: purchaseRecord.id,
        cnftId: cnft.id,
      }
    })

    purchaseRecordId = result.purchaseRecordId
    cnftId = result.cnftId
  } catch (error: any) {
    console.error('[project-purchase/prepare] Failed to create purchase records:', error)
    setResponseStatus(event, 500)
    return fail('Failed to create purchase record', 500)
  }

  const sessionId = createProjectPurchaseSession({
    purchaseRecordId,
    cnftId,
    merkleTreeId: availableTree.id,
    merkleTreeAddress: availableTree.treeAddress,
    leafIndex,
    buyerWalletAddress,
    receiverWalletAddress,
    priceLamports,
    network,
    treeAuthorityKeypair,
  })

  return ok({
    sessionId,
    purchaseId: purchaseRecordId.toString(),
    serializedTransactionBase64: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString('base64'),
    priceLamports: priceLamports.toString(),
    priceSol: lamportsToSolDisplay(priceLamports),
    network,
    expiresAt: Date.now() + 5 * 60 * 1000,
  })
})
