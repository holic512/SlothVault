/**
 * @file release-evidence.ts
 * @project SlothVault
 * @module Release Transaction Evidence
 * @description Owns version-bound Solana Memo evidence preparation, signed submission, durable reconciliation, listing, public lookup, and network health checks.
 * @logic Recompute immutable release identity, reserve the version/network singleton, persist a signed attempt before broadcast, finalize only from matching chain facts, and keep uncertain outcomes recoverable.
 * @dependencies Prisma transactions, project-version release service, Solana evidence protocol and RPC runtime, system installation/configuration
 * @index_tags release,evidence,solana,memo,prepare,submit,reconcile,public-verification
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'
import { PublicKey } from '@solana/web3.js'

import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import {
  evidenceRpcError,
  finalizedEvidenceTransaction,
  isEvidenceRpcConnectionFailure,
  testEvidenceEndpoint,
  withEvidenceRpc,
} from '@/server/services/release-evidence-chain'
import {
  assertSignedEvidenceTransaction,
  buildEvidenceTransaction,
  canonicalEvidenceMemo,
  evidenceMessageHash,
  parseSignedEvidence,
  serializePreparedEvidence,
} from '@/server/services/release-evidence-protocol'
import { getProjectVersionIntegrity } from '@/server/services/project-version-release'
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
) {
  return unitOfWork.execute(async (tx) => {
    const attempt = await tx.releaseCredentialAttempt.findUnique({ where: { id: attemptId } })
    if (!attempt || attempt.status === ATTEMPT_STATUS.FINALIZED) return attempt
    await tx.releaseCredentialAttempt.update({
      where: { id: attempt.id },
      data: {
        status: ATTEMPT_STATUS.FAILED,
        failureCode: code,
        failureMessage: message.slice(0, 500),
        updatedAt: new Date(),
      },
    })
    const latestAttempt = await tx.releaseCredentialAttempt.findFirst({
      where: { credentialId: attempt.credentialId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (latestAttempt?.id !== attempt.id) return attempt
    await tx.releaseCredential.updateMany({
      where: {
        id: attempt.credentialId,
        status: { not: CREDENTIAL_STATUS.FINALIZED },
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
  const attempt = await prisma.releaseCredentialAttempt.findUnique({
    where: { id: input.attemptId },
    select: { id: true, issuerUserId: true, status: true },
  })
  if (!attempt || attempt.issuerUserId !== input.issuerUserId) {
    throw new HttpError('Evidence signing attempt not found', 404, 404)
  }
  if (attempt.status !== ATTEMPT_STATUS.PREPARED) {
    throw new HttpError('Only an unsigned evidence attempt can be cancelled', 409, 409)
  }
  await failAttempt(
    attempt.id,
    'WALLET_SIGNATURE_CANCELLED',
    (input.reason || 'The wallet declined or cancelled the signature request').slice(0, 500),
  )
  return { attemptId: String(attempt.id), status: ATTEMPT_STATUS.FAILED }
}

async function requireVersionForEvidence(projectVersionId: number) {
  const version = await prisma.projectVersion.findUnique({
    where: { id: projectVersionId },
    select: {
      id: true,
      projectId: true,
      version: true,
      isDeleted: true,
      releaseId: true,
      releaseHash: true,
      manifestVersion: true,
      publishedAt: true,
      project: { select: { projectName: true, isDeleted: true } },
    },
  })
  if (
    !version ||
    version.isDeleted ||
    version.project.isDeleted ||
    !version.publishedAt ||
    !version.releaseId ||
    !version.releaseHash ||
    version.manifestVersion === null
  ) {
    throw new HttpError('Published project version not found', 404, 404)
  }
  const integrity = await getProjectVersionIntegrity(version.id)
  if (!integrity.valid || integrity.computedHash !== version.releaseHash) {
    throw new HttpError('Release integrity verification failed', 409, 409, {
      reason: 'RELEASE_INTEGRITY_FAILED',
      issues: integrity.issues,
    })
  }
  return {
    ...version,
    releaseId: version.releaseId,
    releaseHash: version.releaseHash,
    manifestVersion: version.manifestVersion,
  } as typeof version & {
    releaseId: string
    releaseHash: string
    manifestVersion: number
  }
}

export async function prepareReleaseEvidence(input: {
  projectVersionId: number
  network: SolanaNetwork
  signerAddress: string
  issuerUserId: number
}) {
  await requireEnabledSolanaNetwork(input.network)
  const signer = parseSigner(input.signerAddress)
  const version = await requireVersionForEvidence(input.projectVersionId)
  const memo = canonicalEvidenceMemo({
    installationId: await installationId(),
    releaseId: version.releaseId,
    manifestVersion: version.manifestVersion,
    releaseHash: version.releaseHash,
    network: input.network,
    signer: signer.toBase58(),
  })

  const existing = await prisma.releaseCredential.findUnique({
    where: {
      projectVersionId_network: {
        projectVersionId: input.projectVersionId,
        network: input.network,
      },
    },
    include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })
  if (existing?.status === CREDENTIAL_STATUS.FINALIZED) {
    throw new HttpError('This version already has finalized evidence on the selected network', 409, 409, {
      reason: 'EVIDENCE_ALREADY_FINALIZED',
      credentialId: String(existing.id),
    })
  }
  if (existing?.status === CREDENTIAL_STATUS.SUBMITTED) {
    await reconcileReleaseEvidence(existing.id)
    const current = await prisma.releaseCredential.findUnique({ where: { id: existing.id } })
    if (current?.status !== CREDENTIAL_STATUS.FAILED) {
      throw new HttpError('This version already has a submitted evidence transaction', 409, 409, {
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
  if (latestAttempt?.status === ATTEMPT_STATUS.PREPARED) {
    await failAttempt(latestAttempt.id, 'PREPARE_EXPIRED', 'The signing window expired')
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
      const transaction = buildEvidenceTransaction({
        memo,
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
        transactionBase64: serializePreparedEvidence(transaction),
        messageHash: evidenceMessageHash(transaction),
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
      const credential = existing
        ? await tx.releaseCredential.update({
            where: { id: existing.id },
            data: {
              issuerUserId: input.issuerUserId,
              signerAddress: signer.toBase58(),
              memo,
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
              projectVersionId: input.projectVersionId,
              issuerUserId: input.issuerUserId,
              network: input.network,
              signerAddress: signer.toBase58(),
              memo,
              status: CREDENTIAL_STATUS.PREPARED,
            },
          })
      const attempt = await tx.releaseCredentialAttempt.create({
        data: {
          credentialId: credential.id,
          issuerUserId: input.issuerUserId,
          signerAddress: signer.toBase58(),
          memo,
          messageHash: prepared.messageHash,
          recentBlockhash: prepared.blockhash,
          lastValidBlockHeight: BigInt(prepared.lastValidBlockHeight),
          expiresAt,
          status: ATTEMPT_STATUS.PREPARED,
        },
      })
      return { credential, attempt }
    })
    return {
      credentialId: String(stored.credential.id),
      attemptId: String(stored.attempt.id),
      transactionBase64: prepared.transactionBase64,
      expiresAt: expiresAt.getTime(),
      feeLamports: prepared.feeLamports,
      balanceLamports: prepared.balanceLamports,
      memo,
      signerAddress: signer.toBase58(),
      project: version.project.projectName,
      version: version.version,
      releaseHash: version.releaseHash,
      network: input.network,
    }
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) {
      throw new HttpError('This version already has evidence on the selected network', 409, 409)
    }
    throw error
  }
}

export async function submitReleaseEvidence(input: {
  attemptId: number
  signedTransactionBase64: string
  issuerUserId: number
}) {
  const attempt = await prisma.releaseCredentialAttempt.findUnique({
    where: { id: input.attemptId },
    include: { credential: true },
  })
  if (!attempt || attempt.issuerUserId !== input.issuerUserId) {
    throw new HttpError('Evidence signing attempt not found', 404, 404)
  }
  if (attempt.status === ATTEMPT_STATUS.FINALIZED) {
    return credentialResult(attempt.credential)
  }
  if (attempt.status === ATTEMPT_STATUS.SUBMITTED) {
    return credentialResult(await reconcileReleaseEvidence(attempt.credentialId))
  }
  if (attempt.status === ATTEMPT_STATUS.FAILED) {
    throw new HttpError('Evidence signing attempt has failed; prepare a new one', 409, 409)
  }
  if (attempt.credential.status === CREDENTIAL_STATUS.FINALIZED) {
    throw new HttpError('This version already has finalized evidence on the selected network', 409, 409, {
      reason: 'EVIDENCE_ALREADY_FINALIZED',
      credentialId: String(attempt.credentialId),
    })
  }
  const latestAttempt = await prisma.releaseCredentialAttempt.findFirst({
    where: { credentialId: attempt.credentialId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (latestAttempt?.id !== attempt.id || attempt.credential.status !== CREDENTIAL_STATUS.PREPARED) {
    throw new HttpError('This evidence signing attempt is no longer active', 409, 409, {
      reason: 'EVIDENCE_ATTEMPT_STALE',
    })
  }
  if (attempt.status === ATTEMPT_STATUS.PREPARED && attempt.expiresAt.getTime() <= Date.now()) {
    await failAttempt(attempt.id, 'PREPARE_EXPIRED', 'The signing window expired')
    throw new HttpError('Evidence signing request expired', 409, 409)
  }

  const transaction = parseSignedEvidence(input.signedTransactionBase64)
  const signature = assertSignedEvidenceTransaction({
    transaction,
    memo: attempt.memo,
    signerAddress: attempt.signerAddress,
    messageHash: attempt.messageHash,
  })

  try {
    await unitOfWork.execute(async (tx) => {
      await tx.releaseCredentialAttempt.update({
        where: { id: attempt.id },
        data: {
          transactionSignature: signature,
          status: ATTEMPT_STATUS.SUBMITTED,
          submittedAt: new Date(),
          failureCode: null,
          failureMessage: null,
          updatedAt: new Date(),
        },
      })
      await tx.releaseCredential.update({
        where: { id: attempt.credentialId },
        data: {
          transactionSignature: signature,
          status: CREDENTIAL_STATUS.SUBMITTED,
          updatedAt: new Date(),
        },
      })
    })
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) {
      throw new HttpError('Transaction signature is already assigned to another credential', 409, 409)
    }
    throw error
  }

  try {
    const raw = transaction.serialize()
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
  } catch (error) {
    if (isEvidenceRpcConnectionFailure(error)) {
      console.warn('[release-evidence] Submission outcome is unknown; reconciliation retained', error)
    } else {
      await failAttempt(
        attempt.id,
        'CHAIN_SUBMISSION_FAILED',
        error instanceof Error ? error.message : 'Solana rejected the transaction submission',
      )
      evidenceRpcError(error, 'submit release evidence')
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

export async function reconcileReleaseEvidence(credentialId: number) {
  const credential = await prisma.releaseCredential.findUnique({
    where: { id: credentialId },
    include: {
      attempts: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })
  if (!credential) throw new HttpError('Release credential not found', 404, 404)
  const alreadyFinalized = credential.status === CREDENTIAL_STATUS.FINALIZED
  const attempt = credential.attempts[0]
  if (!attempt) throw new HttpError('Release credential attempt is missing', 409, 409)

  if (!credential.transactionSignature) {
    if (attempt.expiresAt.getTime() <= Date.now()) {
      await failAttempt(attempt.id, 'PREPARE_EXPIRED', 'The signing window expired')
      return prisma.releaseCredential.findUniqueOrThrow({ where: { id: credential.id } })
    }
    return credential
  }

  let chain: Awaited<ReturnType<typeof finalizedEvidenceTransaction>>
  try {
    chain = await finalizedEvidenceTransaction(
      credential.network as SolanaNetwork,
      credential.transactionSignature,
    )
  } catch (error) {
    evidenceRpcError(error, 'reconcile release evidence')
  }
  if (!chain) {
    if (alreadyFinalized) return credential
    try {
      const expired = await withEvidenceRpc(
        credential.network as SolanaNetwork,
        async (connection) => BigInt(await connection.getBlockHeight('confirmed')) > attempt.lastValidBlockHeight,
      )
      if (expired) {
        await failAttempt(attempt.id, 'BLOCKHASH_EXPIRED', 'Transaction was not finalized before its blockhash expired')
        return prisma.releaseCredential.findUniqueOrThrow({ where: { id: credential.id } })
      }
    } catch (error) {
      evidenceRpcError(error, 'check evidence expiration')
    }
    return credential
  }
  if (chain.failed) {
    if (alreadyFinalized) return credential
    await failAttempt(attempt.id, 'CHAIN_TRANSACTION_FAILED', 'Solana finalized the transaction with an error')
    return prisma.releaseCredential.findUniqueOrThrow({ where: { id: credential.id } })
  }
  try {
    const chainSignature = assertSignedEvidenceTransaction({
      transaction: chain.transaction,
      memo: credential.memo,
      signerAddress: credential.signerAddress,
      messageHash: attempt.messageHash,
    })
    if (chainSignature !== credential.transactionSignature) {
      throw new HttpError('Finalized transaction signature does not match the credential', 409, 409)
    }
  } catch (error) {
    if (alreadyFinalized) return credential
    await failAttempt(attempt.id, 'CHAIN_EVIDENCE_MISMATCH', error instanceof Error ? error.message : 'Chain evidence mismatch')
    return prisma.releaseCredential.findUniqueOrThrow({ where: { id: credential.id } })
  }

  const finalizedAt = new Date()
  if (alreadyFinalized) {
    return prisma.releaseCredential.update({
      where: { id: credential.id },
      data: { lastVerifiedAt: finalizedAt, updatedAt: finalizedAt },
    })
  }
  return unitOfWork.execute(async (tx) => {
    await tx.releaseCredentialAttempt.update({
      where: { id: attempt.id },
      data: {
        status: ATTEMPT_STATUS.FINALIZED,
        finalizedAt,
        updatedAt: finalizedAt,
      },
    })
    return tx.releaseCredential.update({
      where: { id: credential.id },
      data: {
        status: CREDENTIAL_STATUS.FINALIZED,
        slot: chain.slot,
        blockTime: chain.blockTime,
        feeLamports: chain.feeLamports,
        finalizedAt,
        lastVerifiedAt: finalizedAt,
        updatedAt: finalizedAt,
      },
    })
  })
}

function evidenceWhere(input: {
  projectId?: number
  projectVersionId?: number
  network?: SolanaNetwork
  status?: number
  signerAddress?: string
  transactionSignature?: string
}): Prisma.ReleaseCredentialWhereInput {
  return {
    ...(input.projectVersionId ? { projectVersionId: input.projectVersionId } : {}),
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

function evidenceDto(credential: Prisma.ReleaseCredentialGetPayload<{
  include: {
    projectVersion: { include: { project: true } }
    issuerUser: true
    attempts: true
  }
}>) {
  return {
    id: String(credential.id),
    projectVersionId: String(credential.projectVersionId),
    projectId: String(credential.projectVersion.projectId),
    projectName: credential.projectVersion.project.projectName,
    version: credential.projectVersion.version,
    releaseId: credential.projectVersion.releaseId,
    releaseHash: credential.projectVersion.releaseHash,
    manifestVersion: credential.projectVersion.manifestVersion,
    versionVisible:
      !credential.projectVersion.isDeleted &&
      credential.projectVersion.status === 1 &&
      !credential.projectVersion.project.isDeleted &&
      credential.projectVersion.project.status === 1,
    issuer: credential.issuerUser.displayName || credential.issuerUser.username,
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
      orderBy: { createdAt: 'desc' },
      include: {
        projectVersion: { include: { project: true } },
        issuerUser: true,
        attempts: { orderBy: { createdAt: 'desc' } },
      },
    }),
    prisma.releaseCredential.groupBy({ by: ['network', 'status'], _count: { id: true } }),
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

export async function getPublicReleaseEvidence(signature: string) {
  const credential = await prisma.releaseCredential.findUnique({
    where: { transactionSignature: signature },
    include: {
      projectVersion: { include: { project: true } },
      issuerUser: true,
      attempts: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!credential) return null
  const stored = evidenceDto(credential)
  return {
    id: stored.id,
    projectVersionId: stored.projectVersionId,
    projectId: stored.projectId,
    projectName: stored.versionVisible ? stored.projectName : null,
    version: stored.versionVisible ? stored.version : null,
    releaseId: stored.releaseId,
    releaseHash: stored.releaseHash,
    manifestVersion: stored.manifestVersion,
    versionVisible: stored.versionVisible,
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

export async function verifyPublicReleaseEvidence(signature: string) {
  const evidence = await getPublicReleaseEvidence(signature)
  if (!evidence) throw new HttpError('Release evidence not found', 404, 404)
  let chain: Awaited<ReturnType<typeof finalizedEvidenceTransaction>>
  try {
    chain = await finalizedEvidenceTransaction(evidence.network as SolanaNetwork, signature)
  } catch (error) {
    evidenceRpcError(error, 'verify public release evidence')
  }
  if (!chain || chain.failed) return { verified: false, evidence }
  const storedAttempt = await prisma.releaseCredentialAttempt.findFirst({
    where: {
      credentialId: Number(evidence.id),
      transactionSignature: signature,
    },
    orderBy: { createdAt: 'desc' },
  })
  if (!storedAttempt) return { verified: false, evidence }
  try {
    const chainSignature = assertSignedEvidenceTransaction({
      transaction: chain.transaction,
      memo: evidence.memo,
      signerAddress: evidence.signerAddress,
      messageHash: storedAttempt.messageHash,
    })
    return {
      verified: chainSignature === signature,
      evidence,
      chain: {
        slot: chain.slot.toString(),
        blockTime: chain.blockTime,
        feeLamports: chain.feeLamports.toString(),
      },
    }
  } catch {
    return { verified: false, evidence }
  }
}

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
