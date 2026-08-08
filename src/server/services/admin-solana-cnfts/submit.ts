/**
 * @file submit.ts
 * @project SlothVault
 * @module Solana cNFT Submission
 * @description Validates signed prepared transactions, submits them, and reconciles their persisted cNFT attempts.
 * @logic Open the sealed session, bind and persist the deterministic signature, submit the exact prepared message, and report the reconciled state.
 * @dependencies server/prisma, solana-chain, solana-session, cNFT attempt state and reconciliation
 * @index_tags admin,solana,cnft,submit,signature,reconciliation
 * @author holic512
 */
import 'server-only'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import {
  assertPreparedTransaction,
  getSolanaConnection,
  isLikelyRpcError,
  parseSignedTransaction,
  sendAndConfirmPreparedTransaction,
  signedTransactionSignature,
} from '@/server/services/solana-chain'
import { openSolanaSession } from '@/server/services/solana-session'

import {
  CNFT_STATUS,
  cnftResult,
  finalizeFailedAttempt,
  persistSubmittedSignature,
} from './attempts'
import { reconcileCnftAttempt } from './reconciliation'

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
