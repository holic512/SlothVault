/**
 * @file release-evidence.ts
 * @project SlothVault
 * @module Unified Content Evidence Ledger
 * @description Owns project-version Solana Memo evidence preparation, durable submission, reconciliation, listing, and public verification in one ledger.
 * @logic Reserve immutable subjects, persist signatures before broadcast, recover matching finalized transactions by hash, reconcile signed history before retries, and distinguish finality delays from expiry.
 * @dependencies Prisma transactions, release integrity, project-version evidence protocol, Solana RPC runtime, system configuration
 * @index_tags release,notes,content,evidence,solana,memo,ledger,verification
 * @author holic512
 */
import 'server-only'
import { resolvePublicProjectIds } from './public-content-ids'
import { evidenceNetworks, evidenceVisible, type EvidenceAudience } from '@/lib/evidence-visibility'
import { assertActiveAdministrator } from '@/server/auth/administrator'
import { attributedOperator } from '@/lib/user-attribution'
import type { AccessViewer } from '@/lib/content-access'
import { resolveProjectAccess } from './content-access'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { evidenceLog, evidenceReason, TERMINAL_EVIDENCE_REASONS } from '@/lib/evidence-diagnostics'

import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import {
  evidenceRpcError,
  finalizedEvidenceTransaction,
  testEvidenceEndpoint,
  withEvidenceRpc,
} from '@/server/services/release-evidence-chain'
import { logEvidenceBroadcastError } from '@/server/services/solana-evidence-broadcast'
import {
  PROJECT_VERSION_EVIDENCE_SUBJECT,
  assertSignedProjectVersionEvidenceTransaction,
  buildProjectVersionEvidenceTransaction,
  canonicalProjectVersionEvidenceMemo,
  projectVersionEvidenceMessageHash,
  parseSignedProjectVersionEvidence,
  serializePreparedProjectVersionEvidence,
  type EvidenceSubjectType,
} from '@/server/services/project-version-evidence-protocol'
import { canonicalReleaseManifest, parseReleaseManifest, releaseManifestHash, RELEASE_MANIFEST_VERSION, type ReleaseManifest } from './release-manifest'
import { getProjectVersionIntegrity, getProjectVersionManifest, lockProjectVersionMetadata } from '@/server/services/project-version-release'
import {
  getDefaultSolanaNetwork,
  getSolanaNetworkProfile,
  requireEnabledSolanaNetwork,
  saveNetworkHealth,
  type NetworkHealthSnapshot,
  type SolanaNetwork,
} from '@/server/services/system-config'

export const CREDENTIAL_STATUS = {
  FAILED: -1,
  PREPARED: 0,
  SUBMITTED: 1,
  FINALIZED: 2,
} as const

export const ATTEMPT_STATUS = {
  FAILED: -1,
  PREPARED: 0,
  SUBMITTED: 1,
  FINALIZED: 2,
} as const

const PREPARE_TTL_MS = 10 * 60 * 1_000

export type EvidenceSubjectInput = { type: 'projectVersion'; projectVersionId: number }

type ResolvedEvidenceSubject = {
  subjectType: EvidenceSubjectType
  subjectId: string
  subjectHash: string
  subjectManifestVersion: number
  projectVersionId: number
  noteContentId: number | null
  releaseId: string
  project: string
  version: string
  manifest: ReleaseManifest
  memo: string
}

function parseSigner(address: string) {
  try {
    return new PublicKey(address)
  } catch {
    throw new HttpError('Invalid signer wallet address', 400, 400)
  }
}

function hasPrismaCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === code
}

async function installationId() {
  const installation = await prisma.systemInstallation.findFirst({
    orderBy: { id: 'asc' },
    select: { installationId: true },
  })
  if (!installation) throw new HttpError('System installation identity is missing', 409, 409)
  return installation.installationId
}

async function failAttempt(
  attemptId: number,
  code: string,
  message: string,
  onlyPrepared = false,
  ignoreChanged = false,
) {
  const owner = await prisma.releaseCredentialAttempt.findUnique({ where: { id: attemptId }, select: { credential: { select: { projectVersionId: true } } } })
  if (!owner) return null
  return unitOfWork.execute(async (tx) => {
    await lockProjectVersionMetadata(tx, owner.credential.projectVersionId)
    const attempt = await tx.releaseCredentialAttempt.findUnique({ where: { id: attemptId } })
    if (!attempt || attempt.status === ATTEMPT_STATUS.FINALIZED) return attempt
    if (onlyPrepared && attempt.status !== ATTEMPT_STATUS.PREPARED) {
      if (ignoreChanged) return attempt
      throw new HttpError('Only an unsigned evidence attempt can be cancelled or expired', 409, 409, { reason: 'EVIDENCE_ATTEMPT_STALE' })
    }
    const changed = await tx.releaseCredentialAttempt.updateMany({
      where: { id: attempt.id, status: onlyPrepared ? ATTEMPT_STATUS.PREPARED : { not: ATTEMPT_STATUS.FINALIZED } },
      data: {
        status: ATTEMPT_STATUS.FAILED,
        failureCode: code,
        failureMessage: message.slice(0, 500),
        updatedAt: new Date(),
      },
    })
    if (!changed.count) {
      if (ignoreChanged) return attempt
      if (onlyPrepared) throw new HttpError('Evidence signing attempt is no longer unsigned', 409, 409)
      return attempt
    }
    evidenceLog('attempt.failed', { attemptId: attempt.id, credentialId: attempt.credentialId, reason: code, status: ATTEMPT_STATUS.FAILED }, true)
    const latestAttempt = await tx.releaseCredentialAttempt.findFirst({
      where: { credentialId: attempt.credentialId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    })
    if (latestAttempt?.id !== attempt.id) return attempt
    await tx.releaseCredential.updateMany({
      where: {
        id: attempt.credentialId,
        status: onlyPrepared ? CREDENTIAL_STATUS.PREPARED : { not: CREDENTIAL_STATUS.FINALIZED },
        ...(onlyPrepared ? { transactionSignature: null } : {}),
      },
      data: { status: CREDENTIAL_STATUS.FAILED, updatedAt: new Date() },
    })
    return attempt
  })
}

export async function cancelReleaseEvidenceAttempt(input: {
  attemptId: number
  issuerUserId: number
  reason?: string
}) {
  await assertActiveAdministrator(prisma, input.issuerUserId)
  const attempt = await prisma.releaseCredentialAttempt.findUnique({
    where: { id: input.attemptId },
    select: { id: true, issuerUserId: true, status: true, credential: { select: { subjectType: true, subjectManifestVersion: true } } },
  })
  if (!attempt || !isCurrentCredential(attempt.credential)) {
    throw new HttpError('Evidence signing attempt not found', 404, 404)
  }
  if (attempt.status !== ATTEMPT_STATUS.PREPARED) {
    throw new HttpError('Only an unsigned evidence attempt can be cancelled', 409, 409)
  }
  await failAttempt(
    attempt.id,
    input.reason && TERMINAL_EVIDENCE_REASONS.has(input.reason) ? input.reason : 'WALLET_SIGNATURE_CANCELLED',
    (input.reason || 'The wallet declined or cancelled the signature request').slice(0, 500),
    true,
  )
  return { attemptId: String(attempt.id), status: ATTEMPT_STATUS.FAILED }
}

async function requireReleaseIntegrity(projectVersionId: number, releaseHash: string) {
  const integrity = await getProjectVersionIntegrity(projectVersionId)
  if (!integrity.valid || integrity.computedHash !== releaseHash) {
    throw new HttpError('Release integrity verification failed', 409, 409, {
      reason: 'RELEASE_INTEGRITY_FAILED',
      issues: integrity.issues,
    })
  }
}

async function resolveEvidenceSubject(input: {
  subject: EvidenceSubjectInput; network: SolanaNetwork; signerAddress: string
}): Promise<ResolvedEvidenceSubject> {
  const version = await prisma.projectVersion.findUnique({ where: { id: input.subject.projectVersionId } })
  if (!version || version.isDeleted || !version.publishedAt || !version.releaseId || !version.releaseHash || version.manifestVersion !== RELEASE_MANIFEST_VERSION) {
    throw new HttpError('Published project version not found', 404, 404)
  }
  const integrity = await getProjectVersionIntegrity(version.id)
  if (!integrity.valid || !integrity.manifest || integrity.computedHash !== version.releaseHash) {
    throw new HttpError('Release integrity verification failed', 409, 409, { reason: 'RELEASE_INTEGRITY_FAILED', issues: integrity.issues })
  }
  const manifest = integrity.manifest
  return {
    subjectType: PROJECT_VERSION_EVIDENCE_SUBJECT, subjectId: version.releaseId,
    subjectHash: version.releaseHash, subjectManifestVersion: RELEASE_MANIFEST_VERSION,
    projectVersionId: version.id, noteContentId: null, releaseId: version.releaseId,
    project: manifest.projectName, version: manifest.version, manifest,
    memo: canonicalProjectVersionEvidenceMemo({ installationId: await installationId(), releaseId: version.releaseId, manifest, releaseHash: version.releaseHash, network: input.network, signer: parseSigner(input.signerAddress).toBase58() }),
  }
}

function isCurrentCredential(value: { subjectType: string; subjectManifestVersion: number }) {
  return value.subjectType === PROJECT_VERSION_EVIDENCE_SUBJECT && value.subjectManifestVersion === RELEASE_MANIFEST_VERSION
}

export async function prepareEvidence(input: {
  subject: EvidenceSubjectInput
  network: SolanaNetwork
  signerAddress: string
  issuerUserId: number
}) {
  const started = performance.now()
  await assertActiveAdministrator(prisma, input.issuerUserId)
  evidenceLog('prepare.start', { network: input.network })
  if (input.subject.type !== 'projectVersion') {
    throw new HttpError('Unsupported evidence subject', 400, 400)
  }
  await requireEnabledSolanaNetwork(input.network)
  const signer = parseSigner(input.signerAddress)
  const subject = await resolveEvidenceSubject(input)

  const found = await prisma.releaseCredential.findUnique({
    where: {
      subjectType_subjectId_network: {
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        network: input.network,
      },
    },
    include: { attempts: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] } },
  })
  const existing = found && isCurrentCredential(found) ? found : null
  if (existing?.status === CREDENTIAL_STATUS.FINALIZED) {
    throw new HttpError('This subject already has finalized evidence on the selected network', 409, 409, {
      reason: 'EVIDENCE_ALREADY_FINALIZED',
      credentialId: String(existing.id),
    })
  }
  if (existing && (existing.status === CREDENTIAL_STATUS.SUBMITTED || existing.attempts.some(attempt => attempt.transactionSignature))) {
    const current = await reconcileReleaseEvidence(existing.id)
    if (current.status === CREDENTIAL_STATUS.FINALIZED) {
      throw new HttpError('This subject already has finalized evidence on the selected network', 409, 409, {
        reason: 'EVIDENCE_ALREADY_FINALIZED',
        credentialId: String(existing.id),
      })
    }
    if (current.status === CREDENTIAL_STATUS.SUBMITTED) {
      throw new HttpError('This subject already has a submitted evidence transaction', 409, 409, {
        reason: 'EVIDENCE_ALREADY_SUBMITTED',
        credentialId: String(existing.id),
      })
    }
  }
  const latestAttempt = existing?.attempts[0]
  if (
    existing?.status === CREDENTIAL_STATUS.PREPARED &&
    latestAttempt && latestAttempt.expiresAt.getTime() > Date.now()
  ) {
    throw new HttpError('An evidence signing request is already active', 409, 409, {
      reason: 'EVIDENCE_PREPARE_ACTIVE',
      attemptId: String(latestAttempt.id),
    })
  }

  let prepared: {
    transactionBase64: string
    messageHash: string
    blockhash: string
    lastValidBlockHeight: number
    feeLamports: number
    balanceLamports: number
  }
  try {
    prepared = await withEvidenceRpc(input.network, async (connection) => {
      const latest = await connection.getLatestBlockhash('confirmed')
      const transaction = buildProjectVersionEvidenceTransaction({
        memo: subject.memo,
        signer,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      })
      const [fee, balance] = await Promise.all([
        connection.getFeeForMessage(transaction.compileMessage()),
        connection.getBalance(signer, 'confirmed'),
      ])
      const feeLamports = fee.value ?? 5_000
      if (balance < feeLamports) {
        throw new HttpError('Wallet balance is insufficient for the evidence fee', 400, 400, {
          reason: 'EVIDENCE_BALANCE_INSUFFICIENT',
          balanceLamports: balance,
          requiredLamports: feeLamports,
        })
      }
      return {
        transactionBase64: serializePreparedProjectVersionEvidence(transaction),
        messageHash: projectVersionEvidenceMessageHash(transaction),
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
        feeLamports,
        balanceLamports: balance,
      }
    })
  } catch (error) {
    evidenceRpcError(error, 'prepare release evidence')
  }

  const expiresAt = new Date(Date.now() + PREPARE_TTL_MS)
  try {
    const stored = await unitOfWork.execute(async (tx) => {
      // Serialize reservations for the release, including first creation and expired retries.
      await lockProjectVersionMetadata(tx, subject.projectVersionId)
      let current = await tx.releaseCredential.findUnique({
        where: { subjectType_subjectId_network: { subjectType: subject.subjectType, subjectId: subject.subjectId, network: input.network } },
        include: { attempts: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
      })
      if (current && !isCurrentCredential(current)) {
        await tx.releaseCredentialAttempt.deleteMany({ where: { credentialId: current.id } })
        await tx.releaseCredential.delete({ where: { id: current.id } })
        current = null
      }
      if (current?.status === CREDENTIAL_STATUS.FINALIZED || current?.status === CREDENTIAL_STATUS.SUBMITTED) {
        throw new HttpError('Evidence already submitted on this network', 409, 409, { reason: current.status === CREDENTIAL_STATUS.FINALIZED ? 'EVIDENCE_ALREADY_FINALIZED' : 'EVIDENCE_ALREADY_SUBMITTED' })
      }
      const active = current?.attempts[0]
      if (active?.status === ATTEMPT_STATUS.PREPARED) {
        if (active.expiresAt.getTime() > Date.now()) throw new HttpError('An evidence signing request is already active', 409, 409, { reason: 'EVIDENCE_PREPARE_ACTIVE', attemptId: String(active.id) })
        await tx.releaseCredentialAttempt.update({ where: { id: active.id }, data: { status: ATTEMPT_STATUS.FAILED, failureCode: 'PREPARE_EXPIRED', failureMessage: 'The signing window expired', updatedAt: new Date() } })
      }
      const credential = current
        ? await tx.releaseCredential.update({
            where: { id: current.id },
            data: {
              issuerUserId: input.issuerUserId,
              signerAddress: signer.toBase58(),
              memo: subject.memo,
              subjectHash: subject.subjectHash,
              subjectManifestVersion: subject.subjectManifestVersion,
              transactionSignature: null,
              status: CREDENTIAL_STATUS.PREPARED,
              slot: null,
              blockTime: null,
              feeLamports: null,
              finalizedAt: null,
              lastVerifiedAt: null,
              updatedAt: new Date(),
            },
          })
        : await tx.releaseCredential.create({
            data: {
              projectVersionId: subject.projectVersionId,
              noteContentId: subject.noteContentId,
              issuerUserId: input.issuerUserId,
              subjectType: subject.subjectType,
              subjectId: subject.subjectId,
              subjectHash: subject.subjectHash,
              subjectManifestVersion: subject.subjectManifestVersion,
              network: input.network,
              signerAddress: signer.toBase58(),
              memo: subject.memo,
              status: CREDENTIAL_STATUS.PREPARED,
            },
          })
      const attempt = await tx.releaseCredentialAttempt.create({
        data: {
          credentialId: credential.id,
          issuerUserId: input.issuerUserId,
          signerAddress: signer.toBase58(),
          memo: subject.memo,
          messageHash: prepared.messageHash,
          recentBlockhash: prepared.blockhash,
          lastValidBlockHeight: BigInt(prepared.lastValidBlockHeight),
          expiresAt,
          status: ATTEMPT_STATUS.PREPARED,
        },
      })
      return { credential, attempt }
    })
    evidenceLog('prepare.stored', { attemptId: stored.attempt.id, credentialId: stored.credential.id, network: input.network, elapsedMs: Math.round(performance.now() - started) })
    return {
      credentialId: String(stored.credential.id),
      attemptId: String(stored.attempt.id),
      transactionBase64: prepared.transactionBase64,
      expiresAt: expiresAt.getTime(),
      feeLamports: prepared.feeLamports,
      balanceLamports: prepared.balanceLamports,
      memo: subject.memo,
      signerAddress: signer.toBase58(),
      subjectType: subject.subjectType,
      project: subject.project,
      version: subject.version,
      manifest: subject.manifest,
      releaseHash: subject.subjectHash,
      network: input.network,
    }
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) {
      throw new HttpError('This subject already has evidence on the selected network', 409, 409)
    }
    throw error
  }
}

export async function submitReleaseEvidence(input: {
  attemptId: number
  signedTransactionBase64: string
  issuerUserId: number
}) {
  const started = performance.now()
  await assertActiveAdministrator(prisma, input.issuerUserId)
  evidenceLog('submit.start', { attemptId: input.attemptId })
  try {
    const result = await submitReleaseEvidenceInternal(input)
    evidenceLog('submit.result', { attemptId: input.attemptId, credentialId: result.credentialId,
      network: result.network, status: result.status, transactionSignature: result.transactionSignature, elapsedMs: Math.round(performance.now() - started) })
    return result
  } catch (error) {
    evidenceLog('submit.failed', { attemptId: input.attemptId, reason: evidenceReason(error),
      httpStatus: error instanceof HttpError ? error.status : 500, elapsedMs: Math.round(performance.now() - started) }, true)
    throw error
  }
}

async function submitReleaseEvidenceInternal(input: { attemptId: number; signedTransactionBase64: string; issuerUserId: number }) {
  const attempt = await prisma.releaseCredentialAttempt.findUnique({
    where: { id: input.attemptId },
    include: { credential: true },
  })
  if (!attempt || !isCurrentCredential(attempt.credential)) {
    throw new HttpError('Evidence signing attempt not found', 404, 404)
  }
  if (attempt.status === ATTEMPT_STATUS.FINALIZED) {
    return credentialResult(attempt.credential)
  }
  if (attempt.status === ATTEMPT_STATUS.SUBMITTED) {
    // A previous response may have been lost after persistence. Reuse only the same signed transaction.
    const transaction = parseSignedProjectVersionEvidence(input.signedTransactionBase64)
    const signature = assertSignedProjectVersionEvidenceTransaction({ transaction, memo: attempt.memo,
      signerAddress: attempt.signerAddress, messageHash: attempt.messageHash, recentBlockhash: attempt.recentBlockhash,
      logContext: { attemptId: attempt.id, credentialId: attempt.credentialId, network: attempt.credential.network } })
    if (signature !== attempt.transactionSignature) throw new HttpError('Retry signature does not match the submitted attempt', 409, 409, { reason: 'EVIDENCE_MESSAGE_MISMATCH' })
    evidenceLog('broadcast.retry', { attemptId: attempt.id, credentialId: attempt.credentialId, transactionSignature: signature })
    await withEvidenceRpc(attempt.credential.network as SolanaNetwork,
      (connection) => connection.sendRawTransaction(transaction.serialize(), { maxRetries: 3, preflightCommitment: 'confirmed' }))
      .catch(error => { logEvidenceBroadcastError('broadcast.retry_failed', error, { attemptId: attempt.id, transactionSignature: signature }) })
    return credentialResult(await reconcileReleaseEvidence(attempt.credentialId))
  }
  if (attempt.status === ATTEMPT_STATUS.FAILED) {
    throw new HttpError('Evidence signing attempt has failed; prepare a new one', 409, 409, { reason: 'EVIDENCE_ATTEMPT_FAILED' })
  }
  if (attempt.credential.status === CREDENTIAL_STATUS.FINALIZED) {
    throw new HttpError('This subject already has finalized evidence on the selected network', 409, 409, {
      reason: 'EVIDENCE_ALREADY_FINALIZED',
      credentialId: String(attempt.credentialId),
    })
  }
  const latestAttempt = await prisma.releaseCredentialAttempt.findFirst({
    where: { credentialId: attempt.credentialId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  })
  if (latestAttempt?.id !== attempt.id || attempt.credential.status !== CREDENTIAL_STATUS.PREPARED) {
    throw new HttpError('This evidence signing attempt is no longer active', 409, 409, {
      reason: 'EVIDENCE_ATTEMPT_STALE',
    })
  }
  if (attempt.status === ATTEMPT_STATUS.PREPARED && attempt.expiresAt.getTime() <= Date.now()) {
    await failAttempt(attempt.id, 'PREPARE_EXPIRED', 'The signing window expired', true)
    throw new HttpError('Evidence signing request expired', 409, 409, { reason: 'EVIDENCE_PREPARE_EXPIRED' })
  }

  const context = { attemptId: attempt.id, credentialId: attempt.credentialId, network: attempt.credential.network }
  let transaction: ReturnType<typeof parseSignedProjectVersionEvidence>
  let signature: string
  try {
    await requireReleaseIntegrity(attempt.credential.projectVersionId, attempt.credential.subjectHash)
    transaction = parseSignedProjectVersionEvidence(input.signedTransactionBase64)
    signature = assertSignedProjectVersionEvidenceTransaction({ transaction, memo: attempt.memo,
      signerAddress: attempt.signerAddress, messageHash: attempt.messageHash,
      recentBlockhash: attempt.recentBlockhash, logContext: context })
  } catch (error) {
    const reason = evidenceReason(error)
    if (TERMINAL_EVIDENCE_REASONS.has(reason)) await failAttempt(attempt.id, reason, reason, true, true)
    throw error
  }
  evidenceLog('submit.validated', { ...context, transactionSignature: signature })

  try {
    await unitOfWork.execute(async (tx) => {
      await lockProjectVersionMetadata(tx, attempt.credential.projectVersionId)
      const claimed = await tx.releaseCredentialAttempt.updateMany({
        where: { id: attempt.id, status: ATTEMPT_STATUS.PREPARED, expiresAt: { gt: new Date() } },
        data: {
          transactionSignature: signature,
          status: ATTEMPT_STATUS.SUBMITTED,
          submittedAt: new Date(),
          failureCode: null,
          failureMessage: null,
          updatedAt: new Date(),
        },
      })
      if (claimed.count !== 1) throw new HttpError('Evidence signing attempt is no longer active', 409, 409, { reason: 'EVIDENCE_ATTEMPT_STALE' })
      const bound = await tx.releaseCredential.updateMany({
        where: { id: attempt.credentialId, status: CREDENTIAL_STATUS.PREPARED },
        data: {
          transactionSignature: signature,
          status: CREDENTIAL_STATUS.SUBMITTED,
          updatedAt: new Date(),
        },
      })
      if (bound.count !== 1) throw new HttpError('Evidence credential is no longer unsigned', 409, 409, { reason: 'EVIDENCE_ATTEMPT_STALE' })
    })
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) {
      throw new HttpError('Transaction signature is already assigned to another credential', 409, 409)
    }
    throw error
  }

  evidenceLog('submit.signature_stored', { ...context, transactionSignature: signature })
  try {
    const raw = transaction.serialize()
    evidenceLog('broadcast.start', { ...context, transactionSignature: signature })
    const submitted = await withEvidenceRpc(
      attempt.credential.network as SolanaNetwork,
      (connection) => connection.sendRawTransaction(raw, {
        maxRetries: 3,
        preflightCommitment: 'confirmed',
      }),
    )
    if (submitted !== signature) {
      throw new HttpError('RPC returned an unexpected transaction signature', 502, 502)
    }
    evidenceLog('broadcast.accepted', { ...context, transactionSignature: signature })
  } catch (error) {
    const failure = logEvidenceBroadcastError('broadcast.failed', error, { ...context, transactionSignature: signature })
    if (failure.definitive) {
      await failAttempt(
        attempt.id,
        failure.reason,
        failure.message,
      )
      throw new HttpError(failure.message, 400, 400, { reason: failure.reason })
    }
  }

  return credentialResult(await reconcileReleaseEvidence(attempt.credentialId))
}

function credentialResult(credential: {
  id: number
  transactionSignature: string | null
  status: number
  network: string
}) {
  return {
    credentialId: String(credential.id),
    transactionSignature: credential.transactionSignature,
    status: credential.status,
    network: credential.network,
  }
}

type FinalizedEvidence = {
  attempt: Prisma.ReleaseCredentialAttemptGetPayload<object>
  chain: NonNullable<Awaited<ReturnType<typeof finalizedEvidenceTransaction>>>
}

async function finalizeEvidenceTransactions(
  credential: { id: number; projectVersionId: number },
  finalized: FinalizedEvidence[],
) {
  const { attempt, chain } = finalized[0]
  const finalizedAt = new Date()
  return unitOfWork.execute(async (tx) => {
    await lockProjectVersionMetadata(tx, credential.projectVersionId)
    const current = await tx.releaseCredential.findUniqueOrThrow({ where: { id: credential.id } })
    for (const success of finalized) {
      const stored = await tx.releaseCredentialAttempt.findUniqueOrThrow({ where: { id: success.attempt.id } })
      if (stored.transactionSignature && stored.transactionSignature !== success.attempt.transactionSignature) {
        throw new HttpError('Evidence attempt already has another signature', 409, 409, { reason: 'EVIDENCE_ATTEMPT_STALE' })
      }
      await tx.releaseCredentialAttempt.update({
        where: { id: stored.id },
        data: {
          transactionSignature: success.attempt.transactionSignature,
          status: ATTEMPT_STATUS.FINALIZED, failureCode: null, failureMessage: null,
          submittedAt: stored.submittedAt ?? success.chain.blockTime ?? finalizedAt,
          finalizedAt, updatedAt: finalizedAt,
        },
      })
    }
    if (current.status === CREDENTIAL_STATUS.FINALIZED) {
      if (!finalized.some(success => success.attempt.transactionSignature === current.transactionSignature)) return current
      return tx.releaseCredential.update({
        where: { id: current.id },
        data: { lastVerifiedAt: finalizedAt, updatedAt: finalizedAt },
      })
    }
    await tx.releaseCredentialAttempt.updateMany({
      where: { credentialId: credential.id, status: ATTEMPT_STATUS.PREPARED },
      data: { status: ATTEMPT_STATUS.FAILED, failureCode: 'EVIDENCE_ALREADY_FINALIZED', failureMessage: 'An earlier attempt already finalized this evidence', updatedAt: finalizedAt },
    })
    return tx.releaseCredential.update({
      where: { id: credential.id },
      data: {
        status: CREDENTIAL_STATUS.FINALIZED, transactionSignature: attempt.transactionSignature,
        signerAddress: attempt.signerAddress, memo: attempt.memo, issuerUserId: attempt.issuerUserId,
        attributionJson: attempt.attributionJson,
        slot: chain.slot, blockTime: chain.blockTime, feeLamports: chain.feeLamports,
        finalizedAt, lastVerifiedAt: finalizedAt, updatedAt: finalizedAt,
      },
    })
  })
}

export async function syncReleaseEvidenceBySignature(input: {
  network: SolanaNetwork
  signerAddress: string
  transactionSignature: string
  issuerUserId: number
}) {
  await assertActiveAdministrator(prisma, input.issuerUserId)
  const signature = input.transactionSignature.trim()
  try {
    if (bs58.decode(signature).length !== 64) throw new Error('Invalid signature length')
  } catch {
    throw new HttpError('Invalid Solana transaction signature', 400, 400, { reason: 'EVIDENCE_SYNC_SIGNATURE_INVALID' })
  }
  let signerAddress: string
  try { signerAddress = new PublicKey(input.signerAddress.trim()).toBase58() }
  catch { throw new HttpError('Invalid Solana wallet address', 400, 400, { reason: 'EVIDENCE_SYNC_WALLET_INVALID' }) }
  let chain: Awaited<ReturnType<typeof finalizedEvidenceTransaction>>
  try { chain = await finalizedEvidenceTransaction(input.network, signature) }
  catch (error) { evidenceRpcError(error, 'sync release evidence') }
  if (!chain) throw new HttpError('Finalized transaction not found on the selected network', 409, 409, { reason: 'EVIDENCE_SYNC_NOT_FINALIZED' })
  if (chain.failed) throw new HttpError('The transaction failed on chain', 409, 409, { reason: 'CHAIN_TRANSACTION_FAILED' })
  if (chain.transaction.feePayer?.toBase58() !== signerAddress) {
    throw new HttpError('Transaction fee payer does not match the supplied wallet', 409, 409, { reason: 'EVIDENCE_SYNC_WALLET_MISMATCH' })
  }
  const attempt = await prisma.releaseCredentialAttempt.findFirst({
    where: {
      messageHash: projectVersionEvidenceMessageHash(chain.transaction), signerAddress,
      credential: { network: input.network, subjectType: PROJECT_VERSION_EVIDENCE_SUBJECT, subjectManifestVersion: RELEASE_MANIFEST_VERSION },
    },
    include: { credential: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  if (!attempt) throw new HttpError('Transaction does not match evidence prepared by this site', 404, 404, { reason: 'EVIDENCE_SYNC_NOT_MATCHED' })
  const verifiedSignature = assertSignedProjectVersionEvidenceTransaction({
    transaction: chain.transaction, memo: attempt.memo, signerAddress, messageHash: attempt.messageHash,
  })
  if (verifiedSignature !== signature) throw new HttpError('Transaction signature does not match the requested hash', 409, 409, { reason: 'EVIDENCE_SIGNATURE_INVALID' })
  await finalizeEvidenceTransactions(attempt.credential, [{ attempt: { ...attempt, transactionSignature: signature }, chain }])
  evidenceLog('sync.chain_finalized', { credentialId: attempt.credentialId, attemptId: attempt.id, network: input.network, transactionSignature: signature })
  return { evidence: await getAdminReleaseEvidence(attempt.credentialId), syncedSignature: signature }
}

export async function reconcileReleaseEvidence(credentialId: number) {
  evidenceLog('reconcile.start', { credentialId })
  const credential = await prisma.releaseCredential.findUnique({
    where: { id: credentialId },
    include: {
      attempts: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
    },
  })
  if (!credential || !isCurrentCredential(credential)) throw new HttpError('Release credential not found', 404, 404)
  const alreadyFinalized = credential.status === CREDENTIAL_STATUS.FINALIZED
  const latestAttempt = credential.attempts[0]
  if (!latestAttempt) throw new HttpError('Release credential attempt is missing', 409, 409)
  const candidates = credential.attempts.filter(attempt => attempt.transactionSignature).reverse()
  // Older finalized receipts may only retain the signature on the credential.
  if (alreadyFinalized && credential.transactionSignature && !candidates.some(attempt => attempt.transactionSignature === credential.transactionSignature)) {
    candidates.push({ ...latestAttempt, transactionSignature: credential.transactionSignature })
  }
  const finalized: FinalizedEvidence[] = []
  const unresolved: typeof credential.attempts = []
  const queryErrors: unknown[] = []

  // A later unsigned/cancelled retry must not hide an earlier payment. Verify
  // each signed attempt against its own immutable message and signing wallet.
  for (const attempt of candidates) {
    let chain: Awaited<ReturnType<typeof finalizedEvidenceTransaction>>
    try {
      chain = await finalizedEvidenceTransaction(credential.network as SolanaNetwork, attempt.transactionSignature!)
    } catch (error) {
      queryErrors.push(error)
      continue
    }
    if (!chain) {
      if (attempt.status === ATTEMPT_STATUS.SUBMITTED || attempt.failureCode === 'BLOCKHASH_EXPIRED') unresolved.push(attempt)
      continue
    }
    if (chain.failed) {
      await failAttempt(attempt.id, 'CHAIN_TRANSACTION_FAILED', 'Solana finalized the transaction with an error')
      continue
    }
    try {
      const signature = assertSignedProjectVersionEvidenceTransaction({
        transaction: chain.transaction, memo: attempt.memo,
        signerAddress: attempt.signerAddress, messageHash: attempt.messageHash,
      })
      if (signature !== attempt.transactionSignature) throw new HttpError('Finalized transaction signature does not match the attempt', 409, 409)
    } catch {
      await failAttempt(attempt.id, 'CHAIN_EVIDENCE_MISMATCH', 'Finalized transaction does not match the prepared evidence')
      continue
    }
    finalized.push({ attempt, chain })
  }

  if (finalized.length) {
    const { attempt } = finalized[0]
    evidenceLog('reconcile.chain_finalized', { credentialId, attemptId: attempt.id, transactionSignature: attempt.transactionSignature })
    return finalizeEvidenceTransactions(credential, finalized)
  }
  // One unavailable historical transaction must not discard verified successes,
  // but uncertainty must still block a new payment when no success was found.
  if (queryErrors.length) evidenceRpcError(queryErrors[0], 'reconcile release evidence')

  const pending: typeof credential.attempts = []
  for (const attempt of unresolved) {
    let outcome: 'pending' | 'expired' | 'failed'
    try {
      outcome = await withEvidenceRpc(credential.network as SolanaNetwork, async (connection) => {
        // A confirmed transaction can outlive its blockhash while awaiting
        // finality or RPC indexing. Expiry only rules out NEW inclusion.
        const height = BigInt(await connection.getBlockHeight('finalized'))
        if (height <= attempt.lastValidBlockHeight) return 'pending'
        const blockhash = await connection.isBlockhashValid(attempt.recentBlockhash, { commitment: 'confirmed' })
        if (blockhash.value) return 'pending'
        const statuses = await connection.getSignatureStatuses([attempt.transactionSignature!], { searchTransactionHistory: true })
        const status = statuses.value[0]
        if (status?.confirmationStatus === 'finalized' && status.err) return 'failed'
        return status === null ? 'expired' : 'pending'
      })
    } catch (error) {
      evidenceRpcError(error, 'check evidence expiration')
    }
    if (outcome === 'failed') await failAttempt(attempt.id, 'CHAIN_TRANSACTION_FAILED', 'Solana finalized the transaction with an error')
    else if (outcome === 'expired') await failAttempt(attempt.id, 'BLOCKHASH_EXPIRED', 'Transaction was not found on chain after its blockhash expired')
    else pending.push(attempt)
  }
  if (alreadyFinalized) return credential
  if (pending.length) {
    const attempt = pending[0]
    evidenceLog('reconcile.pending', { credentialId, attemptId: attempt.id, transactionSignature: attempt.transactionSignature })
    return unitOfWork.execute(async (tx) => {
      await lockProjectVersionMetadata(tx, credential.projectVersionId)
      const current = await tx.releaseCredential.findUniqueOrThrow({ where: { id: credential.id } })
      if (current.status === CREDENTIAL_STATUS.FINALIZED) return current
      if (current.transactionSignature !== credential.transactionSignature) throw new HttpError('Evidence attempt changed during reconciliation', 409, 409)
      await tx.releaseCredentialAttempt.update({
        where: { id: attempt.id },
        data: { status: ATTEMPT_STATUS.SUBMITTED, failureCode: null, failureMessage: null, updatedAt: new Date() },
      })
      return tx.releaseCredential.update({
        where: { id: credential.id },
        data: { status: CREDENTIAL_STATUS.SUBMITTED, transactionSignature: attempt.transactionSignature, signerAddress: attempt.signerAddress, memo: attempt.memo, issuerUserId: attempt.issuerUserId, attributionJson: attempt.attributionJson, updatedAt: new Date() },
      })
    })
  }
  if (latestAttempt.status === ATTEMPT_STATUS.PREPARED && latestAttempt.expiresAt.getTime() <= Date.now()) {
    await failAttempt(latestAttempt.id, 'PREPARE_EXPIRED', 'The signing window expired', true, true)
  }
  if (credential.status === CREDENTIAL_STATUS.SUBMITTED && !(latestAttempt.status === ATTEMPT_STATUS.PREPARED && latestAttempt.expiresAt.getTime() > Date.now())) {
    await unitOfWork.execute(async (tx) => {
      await lockProjectVersionMetadata(tx, credential.projectVersionId)
      await tx.releaseCredential.updateMany({
        where: { id: credentialId, status: CREDENTIAL_STATUS.SUBMITTED, transactionSignature: credential.transactionSignature },
        data: { status: CREDENTIAL_STATUS.FAILED, updatedAt: new Date() },
      })
    })
  }
  return prisma.releaseCredential.findUniqueOrThrow({ where: { id: credential.id } })
}

function evidenceWhere(input: {
  projectId?: number
  projectVersionId?: number
  subjectType?: EvidenceSubjectType
  network?: SolanaNetwork
  status?: number
  signerAddress?: string
  transactionSignature?: string
}): Prisma.ReleaseCredentialWhereInput {
  return {
    ...(input.projectVersionId ? { projectVersionId: input.projectVersionId } : {}),
    subjectType: PROJECT_VERSION_EVIDENCE_SUBJECT,
    subjectManifestVersion: RELEASE_MANIFEST_VERSION,
    ...(input.projectId
      ? { projectVersion: { projectId: input.projectId } }
      : {}),
    ...(input.network ? { network: input.network } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.signerAddress
      ? { signerAddress: input.signerAddress }
      : {}),
    ...(input.transactionSignature
      ? { transactionSignature: { contains: input.transactionSignature } }
      : {}),
  }
}

const evidenceRelations = {
  projectVersion: { include: { project: true } },
  issuerUser: true,
  attempts: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
} satisfies Prisma.ReleaseCredentialInclude

function evidenceDto(credential: Prisma.ReleaseCredentialGetPayload<{ include: typeof evidenceRelations }>) {
  const versionVisible =
    !credential.projectVersion.isDeleted &&
    credential.projectVersion.status === 1 &&
    !credential.projectVersion.project.isDeleted &&
    credential.projectVersion.project.status === 1
  const subjectVisible = versionVisible
  let manifest: ReleaseManifest
  try {
    const memo = JSON.parse(credential.memo) as { manifest: ReleaseManifest; installationId: string }
    manifest = parseReleaseManifest(canonicalReleaseManifest(memo.manifest))
    if (releaseManifestHash(canonicalReleaseManifest(manifest)) !== credential.subjectHash) throw new Error('Evidence digest mismatch')
    if (typeof memo.installationId !== 'string' || !memo.installationId || canonicalProjectVersionEvidenceMemo({ installationId: memo.installationId, releaseId: credential.subjectId, manifest, releaseHash: credential.subjectHash, network: credential.network as SolanaNetwork, signer: credential.signerAddress }) !== credential.memo) throw new Error('Evidence publication binding mismatch')
  } catch { throw new HttpError('Stored publication evidence snapshot is invalid', 409, 409) }
  return {
    id: String(credential.id),
    subjectType: credential.subjectType as EvidenceSubjectType,
    subjectId: credential.subjectId,
    subjectHash: credential.subjectHash,
    subjectManifestVersion: credential.subjectManifestVersion,
    projectVersionId: String(credential.projectVersionId),
    noteContentId: credential.noteContentId?.toString() ?? null,
    projectId: String(credential.projectVersion.projectId),
    projectName: manifest.projectName,
    version: manifest.version,
    manifest,
    contentHash: manifest.contentHash,
    releaseId: credential.projectVersion.releaseId,
    releaseHash: credential.projectVersion.releaseHash,
    manifestVersion: credential.projectVersion.manifestVersion,
    versionVisible,
    subjectVisible,
    issuer: attributedOperator(credential, 'issuerUserId', credential.issuerUser).displayName || attributedOperator(credential, 'issuerUserId', credential.issuerUser).username,
    network: credential.network,
    signerAddress: credential.signerAddress,
    memo: credential.memo,
    transactionSignature: credential.transactionSignature,
    status: credential.status,
    slot: credential.slot?.toString() ?? null,
    blockTime: credential.blockTime,
    feeLamports: credential.feeLamports?.toString() ?? null,
    finalizedAt: credential.finalizedAt,
    lastVerifiedAt: credential.lastVerifiedAt,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
    attempts: credential.attempts.map((attempt) => ({
      id: String(attempt.id),
      status: attempt.status,
      signerAddress: attempt.signerAddress,
      transactionSignature: attempt.transactionSignature,
      failureCode: attempt.failureCode,
      failureMessage: attempt.failureMessage,
      expiresAt: attempt.expiresAt,
      submittedAt: attempt.submittedAt,
      finalizedAt: attempt.finalizedAt,
      createdAt: attempt.createdAt,
    })),
  }
}

export async function listReleaseEvidence(input: {
  projectId?: number
  projectVersionId?: number
  subjectType?: EvidenceSubjectType
  network?: SolanaNetwork
  status?: number
  signerAddress?: string
  transactionSignature?: string
  page: number
  pageSize: number
}) {
  const where = evidenceWhere(input)
  const [total, list, groups, defaultNetwork] = await Promise.all([
    prisma.releaseCredential.count({ where }),
    prisma.releaseCredential.findMany({
      where,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        ...evidenceRelations,
      },
    }),
    prisma.releaseCredential.groupBy({ where: { subjectType: PROJECT_VERSION_EVIDENCE_SUBJECT, subjectManifestVersion: RELEASE_MANIFEST_VERSION }, by: ['network', 'status'], _count: { id: true } }),
    getDefaultSolanaNetwork(),
  ])
  const [mainnet, devnet] = await Promise.all([
    getSolanaNetworkProfile('mainnet'),
    getSolanaNetworkProfile('devnet'),
  ])
  return {
    list: list.map(evidenceDto),
    total,
    page: input.page,
    pageSize: input.pageSize,
    summary: groups.map((item) => ({
      network: item.network,
      status: item.status,
      count: item._count.id,
    })),
    defaultNetwork,
    networks: [mainnet, devnet].map((profile) => ({
      network: profile.network,
      enabled: profile.enabled,
      hasFallback: Boolean(profile.fallbackUrl),
      health: profile.health,
    })),
  }
}

export async function getAdminReleaseEvidence(id: number) {
  const credential = await prisma.releaseCredential.findUnique({
    where: { id },
    include: {
      ...evidenceRelations,
    },
  })
  if (!credential || !isCurrentCredential(credential)) throw new HttpError('Release evidence not found', 404, 404)
  return evidenceDto(credential)
}

async function readReleaseEvidence(signature: string, audience: EvidenceAudience) {
  const credential = await prisma.releaseCredential.findUnique({
    where: { transactionSignature: signature },
    include: {
      ...evidenceRelations,
    },
  })
  if (!credential || !evidenceVisible(credential.network, audience) || !isCurrentCredential(credential)) return null
  const stored = evidenceDto(credential)
  const redactEditorialSource =
    !stored.subjectVisible
  return {
    id: stored.id,
    subjectType: stored.subjectType,
    subjectId: stored.subjectId,
    subjectHash: stored.subjectHash,
    subjectManifestVersion: stored.subjectManifestVersion,
    projectVersionId: redactEditorialSource ? null : stored.projectVersionId,
    noteContentId: redactEditorialSource ? null : stored.noteContentId,
    projectId: redactEditorialSource ? null : stored.projectId,
    projectName: stored.projectName,
    version: stored.version,
    manifest: stored.manifest,
    contentHash: stored.contentHash,
    releaseId: stored.releaseId,
    releaseHash: redactEditorialSource ? null : stored.releaseHash,
    manifestVersion: redactEditorialSource ? null : stored.manifestVersion,
    versionVisible: stored.versionVisible,
    subjectVisible: stored.subjectVisible,
    network: stored.network,
    signerAddress: stored.signerAddress,
    memo: stored.memo,
    transactionSignature: stored.transactionSignature,
    status: stored.status,
    slot: stored.slot,
    blockTime: stored.blockTime,
    feeLamports: stored.feeLamports,
    finalizedAt: stored.finalizedAt,
    lastVerifiedAt: stored.lastVerifiedAt,
    createdAt: stored.createdAt,
  }
}

export async function getPublicReleaseEvidence(signature: string) {
  const evidence = await readReleaseEvidence(signature, 'public')
  if (!evidence) return null
  const version = evidence.projectVersionId ? await prisma.projectVersion.findUnique({ where: { id: Number(evidence.projectVersionId) }, select: { publicId: true, project: { select: { publicId: true } } } }) : null
  return { ...evidence, id: evidence.subjectId, projectVersionId: version?.publicId ?? null, projectId: version?.project.publicId ?? null, noteContentId: null }
}
export const getAdminReleaseEvidenceReceipt = (signature: string) => readReleaseEvidence(signature, 'admin')

export async function getPublicReleaseEvidenceManifest(signature: string, viewer: AccessViewer = null) {
  const evidence = await getPublicReleaseEvidence(signature)
  if (!evidence || !evidence.subjectVisible || !evidence.projectVersionId || !evidence.projectId) throw new HttpError('Public version evidence manifest not found', 404, 404)
  const resolved = await resolvePublicProjectIds({ id: evidence.projectId, versionId: evidence.projectVersionId })
  const release = await getProjectVersionManifest(resolved.versionId!, { publicProjectId: resolved.projectId, viewer })
  if (release.releaseHash !== evidence.subjectHash) throw new HttpError('Evidence no longer matches the publication', 409, 409)
  return { ...release, manifest: evidence.manifest, hash: release.releaseHash, subjectId: release.releaseId }
}

/** Read only stored compact snapshots and ledger metadata; never load bodies or call RPC. */
async function readProjectVersionEvidenceSummary(projectVersionId: number, options: { publicProjectId?: number; viewer?: AccessViewer }, audience: EvidenceAudience) {
  const version = await prisma.projectVersion.findFirst({
    where: { id: projectVersionId, isDeleted: false, publishedAt: { not: null }, manifestVersion: RELEASE_MANIFEST_VERSION,
      ...(options.publicProjectId !== undefined ? { projectId: options.publicProjectId, status: 1, project: { isDeleted: false, status: 1 } } : {}),
    },
    select: { id: true, publicId: true, version: true, projectId: true, releaseId: true, releaseHash: true, releaseManifestJson: true, publishedAt: true },
  })
  if (!version || !version.releaseId || !version.releaseHash || !version.publishedAt) throw new HttpError('Published version not found', 404, 404)
  let manifest: ReleaseManifest
  try {
    manifest = parseReleaseManifest(version.releaseManifestJson)
    if (manifest.version !== version.version || releaseManifestHash(version.releaseManifestJson!) !== version.releaseHash) throw new Error('Digest mismatch')
  } catch { throw new HttpError('Publication snapshot integrity failed', 409, 409) }
  const [credentials, access] = await Promise.all([
    prisma.releaseCredential.findMany({ where: { projectVersionId, network: { in: evidenceNetworks(audience) }, subjectType: PROJECT_VERSION_EVIDENCE_SUBJECT, subjectManifestVersion: RELEASE_MANIFEST_VERSION, subjectId: version.releaseId },
      select: { network: true, subjectHash: true, status: true, transactionSignature: true, signerAddress: true, blockTime: true, finalizedAt: true },
    }),
    resolveProjectAccess(version.projectId, options.viewer ?? null),
  ])
  if (credentials.some(item => item.subjectHash !== version.releaseHash)) throw new HttpError('Evidence digest differs from publication', 409, 409)
  return { projectVersionId: audience === 'public' ? version.publicId : String(version.id), releaseId: version.releaseId, releaseHash: version.releaseHash, manifest, publishedAt: version.publishedAt,
    canDownload: access.canDownload, downloadReason: access.downloadReason,
    networks: evidenceNetworks(audience).map(network => {
      const credential = credentials.find(item => item.network === network)
      return { network, status: credential?.status ?? null, transactionSignature: credential?.transactionSignature ?? null, signerAddress: credential?.signerAddress ?? null, blockTime: credential?.blockTime ?? null, finalizedAt: credential?.finalizedAt ?? null }
    }),
  }
}

export const getProjectVersionEvidenceSummary = (projectVersionId: number, options: { publicProjectId?: number; viewer?: AccessViewer } = {}) => readProjectVersionEvidenceSummary(projectVersionId, options, 'public')
export const getAdminProjectVersionEvidenceSummary = (projectVersionId: number, options: { viewer?: AccessViewer } = {}) => readProjectVersionEvidenceSummary(projectVersionId, options, 'admin')

async function verifyReleaseEvidence(signature: string, audience: EvidenceAudience) {
  const evidence = await readReleaseEvidence(signature, audience)
  if (!evidence) throw new HttpError('Release evidence not found', 404, 404)
  let chain: Awaited<ReturnType<typeof finalizedEvidenceTransaction>>
  try {
    chain = await finalizedEvidenceTransaction(evidence.network as SolanaNetwork, signature)
  } catch (error) {
    evidenceRpcError(error, 'verify public release evidence')
  }
  const integrity = evidence.subjectVisible && evidence.projectVersionId
    ? await getProjectVersionIntegrity(Number(evidence.projectVersionId)) : null
  const integrityVerified = integrity ? integrity.valid && integrity.computedHash === evidence.subjectHash : null
  let chainVerified = false
  if (chain && !chain.failed) {
    const storedAttempt = await prisma.releaseCredentialAttempt.findFirst({
      where: { credentialId: Number(evidence.id), transactionSignature: signature },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    if (storedAttempt) {
      try {
        chainVerified = assertSignedProjectVersionEvidenceTransaction({ transaction: chain.transaction, memo: evidence.memo, signerAddress: evidence.signerAddress, messageHash: storedAttempt.messageHash }) === signature
      } catch { chainVerified = false }
    }
  }
  return {
    verified: chainVerified && integrityVerified === true, chainVerified, integrityVerified, evidence: audience === 'public' ? await getPublicReleaseEvidence(signature) : evidence,
    ...(chain && !chain.failed ? { chain: { slot: chain.slot.toString(), blockTime: chain.blockTime, feeLamports: chain.feeLamports.toString() } } : {}),
  }
}

export const verifyPublicReleaseEvidence = (signature: string) => verifyReleaseEvidence(signature, 'public')
export const verifyAdminReleaseEvidence = (signature: string) => verifyReleaseEvidence(signature, 'admin')

export async function testReleaseEvidenceNetworks(network?: SolanaNetwork) {
  const networks: SolanaNetwork[] = network ? [network] : ['mainnet', 'devnet']
  const results = []
  for (const item of networks) {
    const profile = await getSolanaNetworkProfile(item)
    const [primary, fallback] = await Promise.all([
      testEvidenceEndpoint(profile.primaryUrl),
      testEvidenceEndpoint(profile.fallbackUrl),
    ])
    const snapshot: NetworkHealthSnapshot = {
      testedAt: new Date().toISOString(),
      primary: { ok: primary.ok, latencyMs: primary.latencyMs, error: primary.error },
      fallback: {
        configured: fallback.configured,
        ok: fallback.ok,
        latencyMs: fallback.latencyMs,
        error: fallback.error,
      },
    }
    await saveNetworkHealth(item, snapshot)
    results.push({ network: item, enabled: profile.enabled, health: snapshot })
  }
  return { networks: results }
}
