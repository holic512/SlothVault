/**
 * @file evidence.ts
 * @project SlothVault
 * @module Commission Evidence Transactions
 * @description Anchors immutable event hashes using administrator-signed Solana Memo transactions.
 * @logic Record unsigned validation failures and expiry, persist signed bytes before broadcast, retry identical payloads during reconciliation, and log safe phase metadata without rewriting frozen snapshots.
 * @dependencies existing Solana Memo transaction and RPC runtime, Prisma
 * @index_tags commissions,evidence,solana,privacy,retry
 * @author holic512
 */
import 'server-only'
import { PublicKey } from '@solana/web3.js'
import { evidenceLog, evidenceReason, TERMINAL_EVIDENCE_REASONS } from '@/lib/evidence-diagnostics'
import { prisma } from '@/server/prisma'
import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { requireEnabledSolanaNetwork, type SolanaNetwork } from '@/server/services/system-config'
import { assertSignedMemoTransaction, buildMemoTransaction, memoTransactionMessageHash, parseSignedMemoTransaction, serializePreparedMemoTransaction } from '@/server/services/solana-memo-transaction'
import { finalizedEvidenceTransaction, withEvidenceRpc } from '@/server/services/release-evidence-chain'
import { logEvidenceBroadcastError } from '@/server/services/solana-evidence-broadcast'
import { canonicalJson, verifySubmissionChain } from './submissions'

export function commissionEvidenceMemo(input: { commissionId: string; eventId: string; snapshotHash: string; previousHash: string | null; network: string }) {
  return canonicalJson({ protocol: 'slothvault.commission', version: 1, ...input })
}
async function verifiedEvent(publicId: string) {
  const event = await prisma.commissionSubmission.findUnique({ where: { publicId }, include: { commission: true } })
  if (!event) throw new HttpError('提交记录不存在', 404, 404)
  const chain = await prisma.commissionSubmission.findMany({ where: { commissionId: event.commissionId }, orderBy: { sequence: 'asc' } })
  verifySubmissionChain(chain, event.commission.commissionId)
  return event
}
export async function prepareWorkflowEvidence(input: { eventId: string; network: SolanaNetwork; signerAddress: string; issuerUserId: number }) {
  evidenceLog('commission.prepare.start', { network: input.network })
  await requireEnabledSolanaNetwork(input.network)
  let signer: PublicKey
  try { signer = new PublicKey(input.signerAddress) } catch { throw new HttpError('钱包地址无效', 400, 400) }
  const event = await verifiedEvent(input.eventId)
  const existing = await prisma.commissionProofAttempt.findFirst({ where: { submissionId: event.id, network: input.network, status: 'SUBMITTED' } })
  if (existing) await reconcileWorkflowEvidence(existing.id)
  const memo = commissionEvidenceMemo({ commissionId: event.commission.commissionId, eventId: event.publicId, snapshotHash: event.snapshotHash, previousHash: event.previousHash, network: input.network })
  const prepared = await withEvidenceRpc(input.network, async (connection) => {
    const latest = await connection.getLatestBlockhash('confirmed')
    const transaction = buildMemoTransaction({ memo, signer, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight })
    const [fee, balance] = await Promise.all([connection.getFeeForMessage(transaction.compileMessage()), connection.getBalance(signer, 'confirmed')])
    const feeLamports = fee.value ?? 5000
    if (balance < feeLamports) throw new HttpError('钱包余额不足以支付存证手续费', 400, 400)
    return { transactionBase64: serializePreparedMemoTransaction(transaction), messageHash: memoTransactionMessageHash(transaction), lastValidBlockHeight: BigInt(latest.lastValidBlockHeight), feeLamports, balanceLamports: balance }
  })
  const expiresAt = new Date(Date.now() + 10 * 60000)
  const attempt = await unitOfWork.execute(async (tx) => {
    await tx.commissionSubmission.update({ where: { id: event.id }, data: { proofRevision: { increment: 1 } } })
    const live = await tx.commissionProofAttempt.findMany({ where: { submissionId: event.id, network: input.network, status: { in: ['PREPARED', 'SUBMITTED', 'FINALIZED'] } } })
    if (live.some((row) => row.status !== 'PREPARED' || row.expiresAt > new Date())) throw new HttpError('已有有效签名请求、已提交交易或已完成存证', 409, 409)
    await tx.commissionProofAttempt.updateMany({ where: { submissionId: event.id, network: input.network, status: 'PREPARED' }, data: { status: 'FAILED', error: '钱包签名请求已过期' } })
    return tx.commissionProofAttempt.create({ data: { submissionId: event.id, issuerUserId: input.issuerUserId, network: input.network, signerAddress: signer.toBase58(), memo, messageHash: prepared.messageHash, transactionBase64: prepared.transactionBase64, lastValidBlockHeight: prepared.lastValidBlockHeight, feeLamports: BigInt(prepared.feeLamports), expiresAt } })
  })
  evidenceLog('commission.prepare.stored', { attemptId: attempt.id, network: input.network })
  return { attemptId: String(attempt.id), transactionBase64: prepared.transactionBase64, signerAddress: attempt.signerAddress, network: input.network, feeLamports: prepared.feeLamports, balanceLamports: prepared.balanceLamports, expiresAt: expiresAt.getTime(), memo }
}
export async function cancelWorkflowEvidence(id: number, issuerUserId: number) {
  const changed = await prisma.commissionProofAttempt.updateMany({ where: { id, issuerUserId, status: 'PREPARED' }, data: { status: 'CANCELLED', error: '管理员未完成钱包签名' } })
  return { cancelled: Boolean(changed.count) }
}
export async function submitWorkflowEvidence(id: number, issuerUserId: number, signedTransactionBase64: string) {
  const started = performance.now()
  evidenceLog('commission.submit.start', { attemptId: id })
  try {
    const result = await submitWorkflowEvidenceInternal(id, issuerUserId, signedTransactionBase64)
    evidenceLog('commission.submit.result', { attemptId: id, status: result.status, transactionSignature: result.signature, elapsedMs: Math.round(performance.now() - started) })
    return result
  } catch (error) {
    evidenceLog('commission.submit.failed', { attemptId: id, reason: evidenceReason(error), httpStatus: error instanceof HttpError ? error.status : 500, elapsedMs: Math.round(performance.now() - started) }, true)
    throw error
  }
}
async function submitWorkflowEvidenceInternal(id: number, issuerUserId: number, signedTransactionBase64: string) {
  const attempt = await prisma.commissionProofAttempt.findFirst({ where: { id, issuerUserId }, include: { submission: true } })
  if (!attempt) throw new HttpError('存证请求不存在', 404, 404)
  if (['SUBMITTED', 'FINALIZED'].includes(attempt.status)) return reconcileWorkflowEvidence(id)
  if (attempt.status !== 'PREPARED') throw new HttpError('钱包签名请求已失效，请重新准备', 409, 409, { reason: 'EVIDENCE_ATTEMPT_FAILED' })
  if (attempt.expiresAt <= new Date()) {
    await prisma.commissionProofAttempt.updateMany({ where: { id, status: 'PREPARED', transactionSignature: null }, data: { status: 'FAILED', error: '钱包签名请求已过期，请重新准备' } })
    throw new HttpError('钱包签名请求已失效，请重新准备', 409, 409, { reason: 'EVIDENCE_PREPARE_EXPIRED' })
  }
  const event = await verifiedEvent(attempt.submission.publicId)
  if (attempt.memo !== commissionEvidenceMemo({ commissionId: event.commission.commissionId, eventId: event.publicId, snapshotHash: event.snapshotHash, previousHash: event.previousHash, network: attempt.network })) throw new HttpError('存证摘要不匹配', 409, 409)
  const context = { attemptId: id, network: attempt.network }
  let transaction: ReturnType<typeof parseSignedMemoTransaction>
  let signature: string
  try {
    transaction = parseSignedMemoTransaction(signedTransactionBase64)
    const preparedTransaction = parseSignedMemoTransaction(attempt.transactionBase64)
    signature = assertSignedMemoTransaction({ transaction, memo: attempt.memo, signerAddress: attempt.signerAddress, messageHash: attempt.messageHash, recentBlockhash: preparedTransaction.recentBlockhash, logContext: context })
  } catch (error) {
    const reason = evidenceReason(error)
    if (TERMINAL_EVIDENCE_REASONS.has(reason)) await prisma.commissionProofAttempt.updateMany({ where: { id, status: 'PREPARED', transactionSignature: null }, data: { status: 'FAILED', error: reason } })
    throw error
  }
  const changed = await prisma.commissionProofAttempt.updateMany({ where: { id, status: 'PREPARED', expiresAt: { gt: new Date() } }, data: { status: 'SUBMITTED', transactionSignature: signature, transactionBase64: signedTransactionBase64 } })
  if (!changed.count) throw new HttpError('存证请求已被处理', 409, 409, { reason: 'EVIDENCE_ATTEMPT_STALE' })
  evidenceLog('commission.submit.signature_stored', { ...context, transactionSignature: signature })
  try {
    evidenceLog('commission.broadcast.start', { ...context, transactionSignature: signature })
    const sent = await withEvidenceRpc(attempt.network as SolanaNetwork, (connection) => connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false }))
    if (sent !== signature) throw new HttpError('RPC 返回的交易签名不匹配', 502, 502)
    evidenceLog('commission.broadcast.accepted', { ...context, transactionSignature: signature })
  } catch (error) {
    const failure = logEvidenceBroadcastError('commission.broadcast.failed', error, { ...context, transactionSignature: signature })
    if (failure.definitive) {
      await prisma.commissionProofAttempt.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'FAILED', error: failure.reason } })
      throw new HttpError(failure.message, 400, 400, { reason: failure.reason })
    }
    // The RPC may have accepted the bytes before disconnecting. Preserve the signature for reconciliation.
    evidenceLog('commission.broadcast.unknown', { ...context, transactionSignature: signature }, true)
    await prisma.commissionProofAttempt.updateMany({ where: { id, status: 'SUBMITTED' }, data: { error: '广播结果待核实，将根据原交易签名重试' } })
  }
  return { id: String(id), status: 'SUBMITTED', signature }
}
export async function reconcileWorkflowEvidence(id: number) {
  evidenceLog('commission.reconcile.start', { attemptId: id })
  const attempt = await prisma.commissionProofAttempt.findUnique({ where: { id }, include: { submission: true } })
  if (!attempt) throw new HttpError('存证记录不存在', 404, 404)
  if (attempt.status === 'PREPARED' && attempt.expiresAt <= new Date()) {
    await prisma.commissionProofAttempt.updateMany({ where: { id, status: 'PREPARED', transactionSignature: null }, data: { status: 'FAILED', error: '钱包签名请求已过期，请重新准备' } })
    const current = await prisma.commissionProofAttempt.findUniqueOrThrow({ where: { id } })
    return { id: String(id), status: current.status, signature: current.transactionSignature }
  }
  if (attempt.status !== 'SUBMITTED') return { id: String(id), status: attempt.status, signature: attempt.transactionSignature }
  const event = await verifiedEvent(attempt.submission.publicId)
  if (attempt.memo !== commissionEvidenceMemo({ commissionId: event.commission.commissionId, eventId: event.publicId, snapshotHash: event.snapshotHash, previousHash: event.previousHash, network: attempt.network })) throw new HttpError('存证与冻结快照不一致', 409, 409)
  const network = attempt.network as SolanaNetwork
  const chain = await finalizedEvidenceTransaction(network, attempt.transactionSignature!)
  let failure: string | null = null
  if (chain) {
    if (chain.failed) failure = '链上交易执行失败'
    else try {
      const signature = assertSignedMemoTransaction({ transaction: chain.transaction, memo: attempt.memo, signerAddress: attempt.signerAddress, messageHash: attempt.messageHash })
      if (signature !== attempt.transactionSignature) failure = '链上交易签名不匹配'
    } catch { failure = '链上交易与准备的存证内容不匹配' }
    if (!failure) {
      await prisma.commissionProofAttempt.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'FINALIZED', slot: chain.slot, blockTime: chain.blockTime, feeLamports: chain.feeLamports, finalizedAt: new Date(), error: null } })
      evidenceLog('commission.reconcile.finalized', { attemptId: id, transactionSignature: attempt.transactionSignature })
      return { id: String(id), status: 'FINALIZED', signature: attempt.transactionSignature }
    }
  } else {
    const height = await withEvidenceRpc(network, (connection) => connection.getBlockHeight('confirmed'))
    if (BigInt(height) > attempt.lastValidBlockHeight) failure = '交易区块哈希已过期，请重新准备签名'
    else {
      // Exact same signed bytes; rebroadcast cannot produce another payment or different event.
      await withEvidenceRpc(network, (connection) => connection.sendRawTransaction(Buffer.from(attempt.transactionBase64, 'base64'), { skipPreflight: false })).catch(() => undefined)
    }
  }
  if (failure) await prisma.commissionProofAttempt.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'FAILED', error: failure } })
  evidenceLog('commission.reconcile.result', { attemptId: id, status: failure ? 'FAILED' : 'SUBMITTED', transactionSignature: attempt.transactionSignature })
  return { id: String(id), status: failure ? 'FAILED' : 'SUBMITTED', signature: attempt.transactionSignature }
}
export async function publicWorkflowEvidence(signature: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{70,100}$/.test(signature)) throw new HttpError('交易签名无效', 400, 400)
  const attempt = await prisma.commissionProofAttempt.findUnique({ where: { transactionSignature: signature }, include: { submission: { include: { commission: true } } } })
  if (!attempt) throw new HttpError('存证不存在', 404, 404)
  const event = attempt.submission
  const expected = commissionEvidenceMemo({ commissionId: event.commission.commissionId, eventId: event.publicId, snapshotHash: event.snapshotHash, previousHash: event.previousHash, network: attempt.network })
  let verified = false, result = '尚未取得最终链上确认'
  let blockTime: string | null = null
  try {
    await verifiedEvent(event.publicId)
    const chain = await finalizedEvidenceTransaction(attempt.network as SolanaNetwork, signature)
    if (chain && !chain.failed && attempt.memo === expected) {
      verified = assertSignedMemoTransaction({ transaction: chain.transaction, memo: expected, signerAddress: attempt.signerAddress, messageHash: attempt.messageHash }) === signature
      blockTime = chain.blockTime?.toISOString() || null
      result = verified ? '链上摘要与冻结快照一致' : '链上摘要不一致'
    }
  } catch { result = '本次核验未完成，请稍后重试或联系管理员' }
  return { verified, result, protocol: 'slothvault.commission', version: 1, eventId: event.publicId, snapshotHash: event.snapshotHash, previousHash: event.previousHash, network: attempt.network, signer: attempt.signerAddress, signature, submittedAt: event.createdAt.toISOString(), blockTime }
}
