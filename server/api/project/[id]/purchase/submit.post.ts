import { PublicKey, Transaction } from '@solana/web3.js'
import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'

import { getAssetId } from '~~/server/utils/bubblegum'
import { prisma } from '~~/server/utils/prisma'
import { PurchaseStatus } from '~~/server/utils/projectPurchase'
import {
  deleteProjectPurchaseSession,
  getProjectPurchaseSession,
} from '~~/server/utils/projectPurchaseSession'
import { fail, ok } from '~~/server/utils/response'
import { getConnection, type SolanaNetwork } from '~~/server/utils/solana'
import {
  isInsufficientBalanceError,
  isRpcConnectionError,
  isTransactionExpiredError,
} from '~~/server/utils/solanaErrors'

interface SubmitPurchaseRequest {
  sessionId?: string
  signedTransactionBase64?: string
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

  const body = await readBody<SubmitPurchaseRequest>(event)
  if (!body?.sessionId || !body?.signedTransactionBase64) {
    setResponseStatus(event, 400)
    return fail('Missing purchase session or signed transaction', 400)
  }

  const session = getProjectPurchaseSession(body.sessionId)
  if (!session) {
    setResponseStatus(event, 400)
    return fail('Purchase session expired, please prepare again', 400)
  }

  const purchaseRecord = await prisma.projectPurchaseRecord.findFirst({
    where: {
      id: session.purchaseRecordId,
      projectId,
    },
    select: {
      id: true,
    },
  })

  if (!purchaseRecord) {
    deleteProjectPurchaseSession(body.sessionId)
    setResponseStatus(event, 404)
    return fail('Purchase record not found', 404)
  }

  let transaction: Transaction
  try {
    transaction = Transaction.from(Buffer.from(body.signedTransactionBase64, 'base64'))
  } catch {
    setResponseStatus(event, 400)
    return fail('Invalid signed transaction', 400)
  }

  const hasAllSignatures = transaction.signatures.every(
    (signature) => signature.signature !== null && signature.signature.length > 0
  )
  if (!hasAllSignatures) {
    setResponseStatus(event, 400)
    return fail('Transaction is missing required signatures', 400)
  }

  const network = session.network as SolanaNetwork
  const connection = await getConnection(network)

  let txSignature = ''
  try {
    txSignature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })

    await prisma.projectPurchaseRecord.update({
      where: { id: session.purchaseRecordId },
      data: {
        status: PurchaseStatus.SUBMITTED,
        txSignature,
        updatedAt: new Date(),
      },
    })
  } catch (error: any) {
    const failureReason = isInsufficientBalanceError(error)
      ? 'Insufficient SOL balance'
      : isTransactionExpiredError(error)
        ? 'Transaction expired'
        : isRpcConnectionError(error)
          ? 'RPC connection failed'
          : error.message || 'Failed to send transaction'

    await prisma.$transaction([
      prisma.projectPurchaseRecord.update({
        where: { id: session.purchaseRecordId },
        data: {
          status: PurchaseStatus.FAILED,
          failureReason,
          updatedAt: new Date(),
        },
      }),
      prisma.compressedNft.update({
        where: { id: session.cnftId },
        data: {
          status: -1,
          updatedAt: new Date(),
        },
      }),
      prisma.merkleTree.update({
        where: { id: session.merkleTreeId },
        data: {
          totalMinted: { decrement: 1 },
          updatedAt: new Date(),
        },
      }),
    ])

    deleteProjectPurchaseSession(body.sessionId)
    setResponseStatus(event, isInsufficientBalanceError(error) ? 400 : 500)
    return fail(failureReason, isInsufficientBalanceError(error) ? 400 : 500)
  }

  const [assetIdPubkey] = getAssetId(new PublicKey(session.merkleTreeAddress), session.leafIndex)
  const assetId = assetIdPubkey.toBase58()

  let confirmationStatus: 'success' | 'failed' | 'pending' = 'pending'
  try {
    const confirmation = await connection.confirmTransaction(
      {
        signature: txSignature,
        blockhash: transaction.recentBlockhash!,
        lastValidBlockHeight: transaction.lastValidBlockHeight!,
      },
      'confirmed'
    )

    confirmationStatus = confirmation.value.err ? 'failed' : 'success'
  } catch {
    try {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const txStatus = await connection.getSignatureStatus(txSignature)
      if (
        txStatus.value?.confirmationStatus === 'confirmed' ||
        txStatus.value?.confirmationStatus === 'finalized'
      ) {
        confirmationStatus = txStatus.value.err ? 'failed' : 'success'
      }
    } catch {
      confirmationStatus = 'pending'
    }
  }

  if (confirmationStatus === 'success') {
    await prisma.$transaction(async (tx) => {
      await tx.compressedNft.update({
        where: { id: session.cnftId },
        data: {
          assetId,
          mintTxSignature: txSignature,
          status: 1,
          updatedAt: new Date(),
        },
      })

      await tx.projectPurchaseRecord.update({
        where: { id: session.purchaseRecordId },
        data: {
          status: PurchaseStatus.COMPLETED,
          txSignature,
          assetId,
          confirmedAt: new Date(),
          updatedAt: new Date(),
          failureReason: null,
        },
      })
    })

    deleteProjectPurchaseSession(body.sessionId)
    return ok({
      purchaseId: session.purchaseRecordId.toString(),
      cnftId: session.cnftId.toString(),
      assetId,
      txSignature,
      status: PurchaseStatus.COMPLETED,
    })
  }

  if (confirmationStatus === 'failed') {
    await prisma.$transaction([
      prisma.projectPurchaseRecord.update({
        where: { id: session.purchaseRecordId },
        data: {
          status: PurchaseStatus.FAILED,
          txSignature,
          assetId,
          failureReason: 'Transaction confirmation failed',
          updatedAt: new Date(),
        },
      }),
      prisma.compressedNft.update({
        where: { id: session.cnftId },
        data: {
          assetId,
          mintTxSignature: txSignature,
          status: -1,
          updatedAt: new Date(),
        },
      }),
      prisma.merkleTree.update({
        where: { id: session.merkleTreeId },
        data: {
          totalMinted: { decrement: 1 },
          updatedAt: new Date(),
        },
      }),
    ])

    deleteProjectPurchaseSession(body.sessionId)
    setResponseStatus(event, 500)
    return fail('Purchase transaction failed', 500, {
      purchaseId: session.purchaseRecordId.toString(),
      txSignature,
      status: PurchaseStatus.FAILED,
    })
  }

  await prisma.$transaction([
    prisma.projectPurchaseRecord.update({
      where: { id: session.purchaseRecordId },
      data: {
        status: PurchaseStatus.SUBMITTED,
        txSignature,
        assetId,
        updatedAt: new Date(),
      },
    }),
    prisma.compressedNft.update({
      where: { id: session.cnftId },
      data: {
        assetId,
        mintTxSignature: txSignature,
        updatedAt: new Date(),
      },
    }),
  ])

  deleteProjectPurchaseSession(body.sessionId)
  return ok({
    purchaseId: session.purchaseRecordId.toString(),
    cnftId: session.cnftId.toString(),
    assetId,
    txSignature,
    status: PurchaseStatus.SUBMITTED,
  })
})
