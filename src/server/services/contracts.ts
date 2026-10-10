/**
 * @file contracts.ts
 * @project SlothVault
 * @module Web2 Contract and Evidence Service
 * @description Reads retained contracts and protected attachments, and verifies existing contract evidence.
 * @logic Authorize retained document reads, validate frozen snapshots, and reconcile existing credentials against finalized chain facts.
 * @dependencies Prisma contracts/files/users, Solana Memo transaction/runtime, network configuration
 * @index_tags contracts,web2,signature,attachment,authorization,solana,evidence,verification
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import {
  evidenceRpcError,
  finalizedEvidenceTransaction,
  withEvidenceRpc,
} from '@/server/services/release-evidence-chain'
import { assertSignedMemoTransaction } from '@/server/services/solana-memo-transaction'
import { readManagedFile } from '@/server/services/admin-files'
import {
  getSolanaNetworkProfile,
  type SolanaNetwork,
} from '@/server/services/system-config'

export const CONTRACT_STATUS = {
  DECLINED: -1,
  CANCELLED: -2,
  DRAFT: 0,
  PENDING_SIGNATURE: 1,
  SIGNED: 2,
} as const

export const CONTRACT_CREDENTIAL_STATUS = {
  FAILED: -1,
  PREPARED: 0,
  SUBMITTED: 1,
  FINALIZED: 2,
} as const

export const CONTRACT_CREDENTIAL_ATTEMPT_STATUS = {
  FAILED: -1,
  PREPARED: 0,
  SUBMITTED: 1,
  FINALIZED: 2,
} as const

export const CONTRACT_ADMIN_AUDIT_ACTION = {
  EVIDENCE_RECONCILED: 'EVIDENCE_RECONCILED',
} as const

type ContractRecord = {
  commissionId?: number | null
  documentType?: string
  sourceRecordId?: number | null
  snapshotJson?: string | null
  snapshotHash?: string | null
  id: number
  contractId: string
  installationId: string | null
  issuerUserId: number
  subjectUserId: number
  title: string
  body: string
  bodyHash: string
  contractHash: string | null
  attachmentFileId: number | null
  attachmentHash: string | null
  partyCommitment: string
  status: number
  issuedAt: Date | null
  signedAt: Date | null
  signedSessionId: string | null
  signedIp: string | null
  signedUserAgent: string | null
  declinedAt: Date | null
  declineReason: string | null
  cancelledAt: Date | null
  createdAt: Date
  updatedAt: Date
  issuerUser: { username: string; displayName: string | null }
  subjectUser: { username: string; displayName: string | null }
  attachmentFile: {
    id: number
    originalName: string
    fileSize: bigint
    businessType: string
    status: number
  } | null
  credentials: Array<{
    id: number
    network: string
    signerAddress: string
    memo: string
    transactionSignature: string | null
    status: number
    slot: bigint | null
    blockTime: Date | null
    feeLamports: bigint | null
    finalizedAt: Date | null
    lastVerifiedAt: Date | null
    createdAt: Date
    updatedAt: Date
    attempts: Array<{
      id: number
      status: number
      transactionSignature: string | null
      failureCode: string | null
      failureMessage: string | null
      expiresAt: Date
      submittedAt: Date | null
      finalizedAt: Date | null
      createdAt: Date
    }>
  }>
  adminAudits: Array<{
    id: number
    action: string
    createdAt: Date
    actorUser: { username: string; displayName: string | null }
  }>
}

const contractInclude = {
  issuerUser: { select: { username: true, displayName: true } },
  subjectUser: { select: { username: true, displayName: true } },
  attachmentFile: {
    select: { id: true, originalName: true, fileSize: true, businessType: true, status: true },
  },
  credentials: {
    orderBy: { createdAt: 'desc' },
    include: { attempts: { orderBy: { createdAt: 'desc' } } },
  },
  adminAudits: {
    orderBy: { createdAt: 'desc' },
    include: { actorUser: { select: { username: true, displayName: true } } },
  },
} satisfies Prisma.ContractInclude

function credentialDto(credential: ContractRecord['credentials'][number]) {
  return {
    id: credential.id.toString(),
    network: credential.network,
    signerAddress: credential.signerAddress,
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
      id: attempt.id.toString(),
      status: attempt.status,
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

function contractDto(contract: ContractRecord, includeAdminAudit = false) {
  return {
    id: contract.id.toString(),
    contractId: contract.contractId,
    snapshotHash: contract.snapshotHash || null,
    providerAccount: contract.adminAudits.find((audit) => audit.action === 'ISSUED')?.actorUser.username || contract.issuerUser.username,
    customerAccount: contract.subjectUser.username,
    associatedFiles: contract.snapshotJson ? (JSON.parse(contract.snapshotJson).attachments || []) as Array<{ originalName: string; fileSize: string; sha256: string }> : [],
    title: contract.title,
    body: contract.body,
    bodyHash: contract.bodyHash,
    contractHash: contract.contractHash,
    attachment: contract.attachmentFile ? {
      id: contract.attachmentFile.id.toString(),
      originalName: contract.attachmentFile.originalName,
      fileSize: contract.attachmentFile.fileSize.toString(),
    } : null,
    status: contract.status,
    issuedAt: contract.issuedAt,
    signedAt: contract.signedAt,
    declinedAt: contract.declinedAt,
    declineReason: contract.declineReason,
    cancelledAt: contract.cancelledAt,
    issuer: {
      id: contract.issuerUserId.toString(),
      username: contract.issuerUser.username,
      displayName: contract.issuerUser.displayName,
    },
    subject: {
      id: contract.subjectUserId.toString(),
      username: contract.subjectUser.username,
      displayName: contract.subjectUser.displayName,
    },
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
    credentials: contract.credentials.map(credentialDto),
    ...(includeAdminAudit ? {
      signedAudit: contract.signedAt ? {
        sessionId: contract.signedSessionId,
        ip: contract.signedIp,
        userAgent: contract.signedUserAgent,
      } : null,
      adminAudit: contract.adminAudits.map((audit) => ({
        id: audit.id.toString(),
        action: audit.action,
        createdAt: audit.createdAt,
        actor: {
          username: audit.actorUser.username,
          displayName: audit.actorUser.displayName,
        },
      })),
    } : {}),
  }
}

async function loadContract(id: number) {
  return prisma.contract.findUnique({ where: { id }, include: contractInclude }) as Promise<ContractRecord | null>
}

async function requireContract(id: number) {
  const contract = await loadContract(id)
  if (!contract) throw new HttpError('Contract not found', 404, 404)
  return contract
}

export async function listAdminContracts(input: {
  page: number
  pageSize: number
  keyword?: string
  status?: number
}) {
  const where: Prisma.ContractWhereInput = {
    ...(input.keyword ? { title: { contains: input.keyword } } : {}),
    ...(input.status === undefined ? {} : { status: input.status }),
  }
  const [total, list] = await Promise.all([
    prisma.contract.count({ where }),
    prisma.contract.findMany({
      where,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: { createdAt: 'desc' },
      include: contractInclude,
    }),
  ])
  return {
    total,
    page: input.page,
    pageSize: input.pageSize,
    list: (list as ContractRecord[]).map((contract) => contractDto(contract, true)),
  }
}

export async function getAdminContract(id: number) {
  return contractDto(await requireContract(id), true)
}

export async function listUserContracts(userId: number, input: { page: number; pageSize: number }) {
  const where: Prisma.ContractWhereInput = {
    subjectUserId: userId,
    status: { not: CONTRACT_STATUS.DRAFT },
    issuedAt: { not: null },
  }
  const [total, list] = await Promise.all([
    prisma.contract.count({ where }),
    prisma.contract.findMany({
      where,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: { createdAt: 'desc' },
      include: contractInclude,
    }),
  ])
  return {
    total,
    page: input.page,
    pageSize: input.pageSize,
    list: (list as ContractRecord[]).map((contract) => contractDto(contract)),
  }
}

export async function getUserContract(userId: number, id: number) {
  const contract = await requireContract(id)
  if (contract.subjectUserId !== userId || contract.status === CONTRACT_STATUS.DRAFT || !contract.issuedAt) {
    throw new HttpError('Contract not found', 404, 404)
  }
  return contractDto(contract)
}

async function failCredentialAttempt(
  attemptId: number,
  code: string,
  message: string,
) {
  return unitOfWork.execute(async (tx) => {
    const attempt = await tx.contractCredentialAttempt.findUnique({ where: { id: attemptId } })
    if (!attempt || attempt.status === CONTRACT_CREDENTIAL_ATTEMPT_STATUS.FINALIZED) return attempt
    await tx.contractCredentialAttempt.update({
      where: { id: attempt.id },
      data: {
        status: CONTRACT_CREDENTIAL_ATTEMPT_STATUS.FAILED,
        failureCode: code,
        failureMessage: message.slice(0, 500),
        updatedAt: new Date(),
      },
    })
    const latest = await tx.contractCredentialAttempt.findFirst({
      where: { credentialId: attempt.credentialId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (latest?.id === attempt.id) {
      await tx.contractCredential.updateMany({
        where: { id: attempt.credentialId, status: { not: CONTRACT_CREDENTIAL_STATUS.FINALIZED } },
        data: { status: CONTRACT_CREDENTIAL_STATUS.FAILED, updatedAt: new Date() },
      })
    }
    return attempt
  })
}


export async function reconcileContractEvidence(credentialId: number, issuerUserId?: number) {
  const credential = await prisma.contractCredential.findUnique({
    where: { id: credentialId },
    include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })
  if (!credential) throw new HttpError('Contract credential not found', 404, 404)
  const audited = async <T>(result: T) => {
    if (issuerUserId) {
      await prisma.contractAdminAudit.create({
        data: {
          contractId: credential.contractId,
          actorUserId: issuerUserId,
          action: CONTRACT_ADMIN_AUDIT_ACTION.EVIDENCE_RECONCILED,
        },
      })
    }
    return result
  }
  const alreadyFinalized = credential.status === CONTRACT_CREDENTIAL_STATUS.FINALIZED
  const attempt = credential.attempts[0]
  if (!attempt) throw new HttpError('Contract credential attempt is missing', 409, 409)
  if (!credential.transactionSignature) {
    if (attempt.expiresAt.getTime() <= Date.now()) {
      await failCredentialAttempt(attempt.id, 'PREPARE_EXPIRED', 'The signing window expired')
      return audited(await prisma.contractCredential.findUniqueOrThrow({ where: { id: credential.id } }))
    }
    return audited(credential)
  }
  let chain: Awaited<ReturnType<typeof finalizedEvidenceTransaction>>
  try {
    chain = await finalizedEvidenceTransaction(credential.network as SolanaNetwork, credential.transactionSignature)
  } catch (error) {
    evidenceRpcError(error, 'reconcile contract evidence')
  }
  if (!chain) {
    if (alreadyFinalized) return audited(credential)
    try {
      const expired = await withEvidenceRpc(
        credential.network as SolanaNetwork,
        async (connection) => BigInt(await connection.getBlockHeight('confirmed')) > attempt.lastValidBlockHeight,
      )
      if (expired) {
        await failCredentialAttempt(attempt.id, 'BLOCKHASH_EXPIRED', 'Transaction was not finalized before its blockhash expired')
        return audited(await prisma.contractCredential.findUniqueOrThrow({ where: { id: credential.id } }))
      }
    } catch (error) {
      evidenceRpcError(error, 'check contract evidence expiration')
    }
    return audited(credential)
  }
  if (chain.failed) {
    if (alreadyFinalized) return audited(credential)
    await failCredentialAttempt(attempt.id, 'CHAIN_TRANSACTION_FAILED', 'Solana finalized the transaction with an error')
    return audited(await prisma.contractCredential.findUniqueOrThrow({ where: { id: credential.id } }))
  }
  try {
    const chainSignature = assertSignedMemoTransaction({
      transaction: chain.transaction,
      memo: credential.memo,
      signerAddress: credential.signerAddress,
      messageHash: attempt.messageHash,
    })
    if (chainSignature !== credential.transactionSignature) throw new HttpError('Finalized transaction signature does not match the credential', 409, 409)
  } catch (error) {
    if (alreadyFinalized) return audited(credential)
    await failCredentialAttempt(attempt.id, 'CHAIN_EVIDENCE_MISMATCH', error instanceof Error ? error.message : 'Chain evidence mismatch')
    return audited(await prisma.contractCredential.findUniqueOrThrow({ where: { id: credential.id } }))
  }
  const finalizedAt = new Date()
  if (alreadyFinalized) {
    return audited(await prisma.contractCredential.update({ where: { id: credential.id }, data: { lastVerifiedAt: finalizedAt, updatedAt: finalizedAt } }))
  }
  return audited(await unitOfWork.execute(async (tx) => {
    await tx.contractCredentialAttempt.update({
      where: { id: attempt.id },
      data: { status: CONTRACT_CREDENTIAL_ATTEMPT_STATUS.FINALIZED, finalizedAt, updatedAt: finalizedAt },
    })
    return tx.contractCredential.update({
      where: { id: credential.id },
      data: {
        status: CONTRACT_CREDENTIAL_STATUS.FINALIZED,
        slot: chain.slot,
        blockTime: chain.blockTime,
        feeLamports: chain.feeLamports,
        finalizedAt,
        lastVerifiedAt: finalizedAt,
        updatedAt: finalizedAt,
      },
    })
  }))
}

export async function getPublicContractEvidence(signature: string) {
  const credential = await prisma.contractCredential.findUnique({
    where: { transactionSignature: signature },
    select: {
      id: true,
      network: true,
      transactionSignature: true,
      status: true,
      slot: true,
      blockTime: true,
      feeLamports: true,
      finalizedAt: true,
      lastVerifiedAt: true,
      createdAt: true,
      contract: { select: { contractHash: true } },
    },
  })
  if (!credential) return null
  return {
    id: String(credential.id),
    contractHash: credential.contract.contractHash,
    network: credential.network,
    transactionSignature: credential.transactionSignature,
    status: credential.status,
    slot: credential.slot?.toString() ?? null,
    blockTime: credential.blockTime,
    feeLamports: credential.feeLamports?.toString() ?? null,
    finalizedAt: credential.finalizedAt,
    lastVerifiedAt: credential.lastVerifiedAt,
    createdAt: credential.createdAt,
  }
}

export async function verifyPublicContractEvidence(signature: string) {
  const evidence = await getPublicContractEvidence(signature)
  if (!evidence) throw new HttpError('Contract evidence not found', 404, 404)
  const verification = await prisma.contractCredential.findUnique({
    where: { transactionSignature: signature },
    select: { network: true, memo: true, signerAddress: true },
  })
  if (!verification) throw new HttpError('Contract evidence not found', 404, 404)
  let chain: Awaited<ReturnType<typeof finalizedEvidenceTransaction>>
  try {
    chain = await finalizedEvidenceTransaction(verification.network as SolanaNetwork, signature)
  } catch (error) {
    evidenceRpcError(error, 'verify contract evidence')
  }
  if (!chain || chain.failed) return { verified: false, evidence }
  const attempt = await prisma.contractCredentialAttempt.findFirst({
    where: { credential: { transactionSignature: signature } },
    orderBy: { createdAt: 'desc' },
  })
  if (!attempt) return { verified: false, evidence }
  try {
    const chainSignature = assertSignedMemoTransaction({
      transaction: chain.transaction,
      memo: verification.memo,
      signerAddress: verification.signerAddress,
      messageHash: attempt.messageHash,
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

export async function readAuthorizedContractAttachment(input: { id: number; userId: number; isAdmin: boolean }) {
  const contract = await requireContract(input.id)
  if (!input.isAdmin && (contract.subjectUserId !== input.userId || contract.status === CONTRACT_STATUS.DRAFT || !contract.issuedAt)) {
    throw new HttpError('Contract not found', 404, 404)
  }
  if (!contract.attachmentFileId) throw new HttpError('Contract attachment not found', 404, 404)
  const { file, buffer } = await readManagedFile(contract.attachmentFileId)
  if (
    file.businessType !== 'ContractAttachment' ||
    !file.originalName.toLowerCase().endsWith('.pdf') ||
    !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))
  ) {
    throw new HttpError('Contract attachment metadata is invalid', 409, 409)
  }
  return { originalName: file.originalName, buffer }
}

export async function contractEvidenceNetworks() {
  const [mainnet, devnet] = await Promise.all([
    getSolanaNetworkProfile('mainnet'),
    getSolanaNetworkProfile('devnet'),
  ])
  return [mainnet, devnet].map((profile) => ({
    network: profile.network,
    enabled: profile.enabled,
    hasFallback: Boolean(profile.fallbackUrl),
    health: profile.health,
  }))
}
