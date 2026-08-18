/**
 * @file contracts.ts
 * @project SlothVault
 * @module Web2 Contract and Evidence Service
 * @description Owns one-to-one contract drafts, frozen content snapshots, Web2 acceptance or rejection, protected PDF access, and independent Solana evidence lifecycle.
 * @logic Freeze normalized body and optional PDF hashes before inviting one active user, record only server-side acceptance audit facts, and accept a chain credential only when its finalized Memo matches the stored private snapshot.
 * @dependencies Prisma contracts/files/users, Solana Memo transaction/runtime, system installation/network configuration
 * @index_tags contracts,web2,signature,attachment,authorization,solana,evidence,verification
 * @author holic512
 */
import 'server-only'

import { randomBytes, randomUUID } from 'node:crypto'

import type { Prisma } from '@generated/prisma-postgresql/client'
import { PublicKey } from '@solana/web3.js'

import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import {
  contractAttachmentHash,
  contractBodyHash,
  canonicalContractEvidenceMemo,
  contractRootHash,
  normalizeContractBody,
  partyCommitment,
} from '@/server/services/contract-evidence-protocol'
import {
  evidenceRpcError,
  finalizedEvidenceTransaction,
  isEvidenceRpcConnectionFailure,
  withEvidenceRpc,
} from '@/server/services/release-evidence-chain'
import {
  assertSignedMemoTransaction,
  buildMemoTransaction,
  memoTransactionMessageHash,
  parseSignedMemoTransaction,
  serializePreparedMemoTransaction,
} from '@/server/services/solana-memo-transaction'
import { readManagedFile } from '@/server/services/admin-files'
import {
  getSolanaNetworkProfile,
  requireEnabledSolanaNetwork,
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
  DRAFT_CREATED: 'DRAFT_CREATED',
  DRAFT_UPDATED: 'DRAFT_UPDATED',
  ISSUED: 'ISSUED',
  CANCELLED: 'CANCELLED',
  EVIDENCE_PREPARED: 'EVIDENCE_PREPARED',
  EVIDENCE_SUBMITTED: 'EVIDENCE_SUBMITTED',
  EVIDENCE_RECONCILED: 'EVIDENCE_RECONCILED',
  EVIDENCE_ATTEMPT_CANCELLED: 'EVIDENCE_ATTEMPT_CANCELLED',
} as const

const PREPARE_TTL_MS = 10 * 60 * 1_000
const CONTRACT_BODY_MAX_LENGTH = 100_000

type ContractRecord = {
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

function hasPrismaCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === code
}

function parseSigner(address: string) {
  try {
    return new PublicKey(address.trim())
  } catch {
    throw new HttpError('Invalid signer wallet address', 400, 400)
  }
}

function normalizedTitle(value: string) {
  const title = value.trim()
  if (!title || title.length > 255) throw new HttpError('Contract title must contain 1–255 characters', 400, 400)
  return title
}

function normalizedBody(value: string) {
  const body = normalizeContractBody(value)
  if (body.trim().length === 0 || body.length > CONTRACT_BODY_MAX_LENGTH) {
    throw new HttpError('Contract body must contain 1–100000 characters', 400, 400)
  }
  return body
}

async function installationId() {
  const installation = await prisma.systemInstallation.findFirst({
    orderBy: { id: 'asc' },
    select: { installationId: true },
  })
  if (!installation) throw new HttpError('System installation identity is missing', 409, 409)
  return installation.installationId
}

async function requireSubjectUser(subjectUserId: number) {
  const user = await prisma.user.findUnique({
    where: { id: subjectUserId },
    select: { id: true, role: true, status: true },
  })
  if (!user || user.status !== 1 || user.role !== 'USER') {
    throw new HttpError('An active regular user is required as the contract party', 400, 400)
  }
  return user
}

async function contractAttachment(input: { attachmentFileId: number | null }) {
  if (!input.attachmentFileId) return { attachmentFileId: null, attachmentHash: null }
  const { file, buffer } = await readManagedFile(input.attachmentFileId)
  if (
    file.businessType !== 'ContractAttachment' ||
    !file.originalName.toLowerCase().endsWith('.pdf') ||
    !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))
  ) {
    throw new HttpError('Contract attachment must be a managed PDF upload', 400, 400)
  }
  return {
    attachmentFileId: file.id,
    attachmentHash: contractAttachmentHash(buffer),
  }
}

function nextPartyCommitment(contractId: string, subjectUserId: number) {
  return partyCommitment({
    contractId,
    subjectUserId,
    nonce: randomBytes(32).toString('hex'),
  })
}

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

async function assertFrozenContractIntegrity(contract: ContractRecord) {
  if (!contract.issuedAt || !contract.installationId) throw new HttpError('Contract issuance record is missing', 409, 409)
  if (contractBodyHash(contract.body) !== contract.bodyHash) {
    throw new HttpError('Contract body integrity verification failed', 409, 409)
  }
  if (contract.attachmentFileId) {
    const attachment = await contractAttachment({ attachmentFileId: contract.attachmentFileId })
    if (attachment.attachmentHash !== contract.attachmentHash) {
      throw new HttpError('Contract attachment integrity verification failed', 409, 409)
    }
  } else if (contract.attachmentHash) {
    throw new HttpError('Contract attachment metadata is inconsistent', 409, 409)
  }
}

async function verifiedContractHash(contract: ContractRecord) {
  await assertFrozenContractIntegrity(contract)
  if (!contract.signedAt || !contract.contractHash) throw new HttpError('Contract has not been signed', 409, 409)
  if (!contract.installationId || !contract.issuedAt) {
    throw new HttpError('Contract issuance record is missing', 409, 409)
  }
  const computed = contractRootHash({
    installationId: contract.installationId,
    contractId: contract.contractId,
    title: contract.title,
    bodyHash: contract.bodyHash,
    attachmentHash: contract.attachmentHash,
    partyCommitment: contract.partyCommitment,
    issuedAt: contract.issuedAt,
    signedAt: contract.signedAt,
  })
  if (computed !== contract.contractHash) {
    throw new HttpError('Contract root hash integrity verification failed', 409, 409)
  }
  return computed
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

export async function createAdminContract(input: {
  issuerUserId: number
  subjectUserId: number
  title: string
  body: string
  attachmentFileId?: number | null
}) {
  await requireSubjectUser(input.subjectUserId)
  const contractId = randomUUID()
  const body = normalizedBody(input.body)
  const attachment = await contractAttachment({ attachmentFileId: input.attachmentFileId ?? null })
  try {
    const contract = await prisma.contract.create({
      data: {
        contractId,
        issuerUserId: input.issuerUserId,
        subjectUserId: input.subjectUserId,
        title: normalizedTitle(input.title),
        body,
        bodyHash: contractBodyHash(body),
        attachmentFileId: attachment.attachmentFileId,
        attachmentHash: attachment.attachmentHash,
        partyCommitment: nextPartyCommitment(contractId, input.subjectUserId),
        adminAudits: {
          create: {
            actorUserId: input.issuerUserId,
            action: CONTRACT_ADMIN_AUDIT_ACTION.DRAFT_CREATED,
          },
        },
      },
      include: contractInclude,
    })
    return contractDto(contract as ContractRecord, true)
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) throw new HttpError('Contract attachment is already in use', 409, 409)
    throw error
  }
}

export async function updateAdminContract(input: {
  id: number
  issuerUserId: number
  subjectUserId: number
  title: string
  body: string
  attachmentFileId?: number | null
}) {
  const current = await requireContract(input.id)
  if (current.status !== CONTRACT_STATUS.DRAFT) {
    throw new HttpError('Only a draft contract can be edited', 409, 409)
  }
  await requireSubjectUser(input.subjectUserId)
  const body = normalizedBody(input.body)
  const attachment = await contractAttachment({ attachmentFileId: input.attachmentFileId ?? null })
  try {
    const contract = await prisma.contract.update({
      where: { id: input.id },
      data: {
        subjectUserId: input.subjectUserId,
        title: normalizedTitle(input.title),
        body,
        bodyHash: contractBodyHash(body),
        attachmentFileId: attachment.attachmentFileId,
        attachmentHash: attachment.attachmentHash,
        partyCommitment: nextPartyCommitment(current.contractId, input.subjectUserId),
        updatedAt: new Date(),
        adminAudits: {
          create: {
            actorUserId: input.issuerUserId,
            action: CONTRACT_ADMIN_AUDIT_ACTION.DRAFT_UPDATED,
          },
        },
      },
      include: contractInclude,
    })
    return contractDto(contract as ContractRecord, true)
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) throw new HttpError('Contract attachment is already in use', 409, 409)
    throw error
  }
}

export async function issueAdminContract(input: { id: number; issuerUserId: number }) {
  const contract = await requireContract(input.id)
  if (contract.status !== CONTRACT_STATUS.DRAFT) {
    throw new HttpError('Only a draft contract can be issued', 409, 409)
  }
  await requireSubjectUser(contract.subjectUserId)
  const body = normalizedBody(contract.body)
  const attachment = await contractAttachment({ attachmentFileId: contract.attachmentFileId })
  const issuedAt = new Date()
  const currentInstallationId = await installationId()
  const issued = await prisma.contract.update({
    where: { id: input.id },
    data: {
      body,
      bodyHash: contractBodyHash(body),
      attachmentHash: attachment.attachmentHash,
      partyCommitment: nextPartyCommitment(contract.contractId, contract.subjectUserId),
      status: CONTRACT_STATUS.PENDING_SIGNATURE,
      installationId: currentInstallationId,
      issuedAt,
      updatedAt: issuedAt,
      adminAudits: {
        create: {
          actorUserId: input.issuerUserId,
          action: CONTRACT_ADMIN_AUDIT_ACTION.ISSUED,
        },
      },
    },
    include: contractInclude,
  })
  return contractDto(issued as ContractRecord, true)
}

export async function cancelAdminContract(input: { id: number; issuerUserId: number }) {
  const contract = await requireContract(input.id)
  if (contract.status !== CONTRACT_STATUS.DRAFT && contract.status !== CONTRACT_STATUS.PENDING_SIGNATURE) {
    throw new HttpError('Only a draft or pending contract can be cancelled', 409, 409)
  }
  const cancelledAt = new Date()
  const cancelled = await unitOfWork.execute(async (tx) => {
    const record = await tx.contract.update({
      where: { id: input.id },
      data: { status: CONTRACT_STATUS.CANCELLED, cancelledAt, updatedAt: cancelledAt },
    })
    await tx.contractAdminAudit.create({
      data: {
        contractId: record.id,
        actorUserId: input.issuerUserId,
        action: CONTRACT_ADMIN_AUDIT_ACTION.CANCELLED,
      },
    })
    return record
  })
  return getAdminContract(cancelled.id)
}

export async function listUserContracts(userId: number, input: { page: number; pageSize: number }) {
  const where: Prisma.ContractWhereInput = {
    subjectUserId: userId,
    status: { not: CONTRACT_STATUS.DRAFT },
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
  if (contract.subjectUserId !== userId || contract.status === CONTRACT_STATUS.DRAFT) {
    throw new HttpError('Contract not found', 404, 404)
  }
  return contractDto(contract)
}

export async function signUserContract(input: {
  id: number
  userId: number
  sessionId: string
  ip: string
  userAgent: string | null
}) {
  const contract = await requireContract(input.id)
  if (contract.subjectUserId !== input.userId) throw new HttpError('Contract not found', 404, 404)
  if (contract.status !== CONTRACT_STATUS.PENDING_SIGNATURE) {
    throw new HttpError('This contract is not awaiting your signature', 409, 409)
  }
  await assertFrozenContractIntegrity(contract)
  const signedAt = new Date()
  const hash = contractRootHash({
    installationId: contract.installationId!,
    contractId: contract.contractId,
    title: contract.title,
    bodyHash: contract.bodyHash,
    attachmentHash: contract.attachmentHash,
    partyCommitment: contract.partyCommitment,
    issuedAt: contract.issuedAt!,
    signedAt,
  })
  const signed = await prisma.contract.updateMany({
    where: {
      id: input.id,
      subjectUserId: input.userId,
      status: CONTRACT_STATUS.PENDING_SIGNATURE,
    },
    data: {
      status: CONTRACT_STATUS.SIGNED,
      signedAt,
      signedSessionId: input.sessionId,
      signedIp: input.ip.slice(0, 255),
      signedUserAgent: input.userAgent?.slice(0, 4_000) || null,
      contractHash: hash,
      updatedAt: signedAt,
    },
  })
  if (signed.count !== 1) {
    throw new HttpError('This contract is not awaiting your signature', 409, 409)
  }
  return getUserContract(input.userId, input.id)
}

export async function declineUserContract(input: { id: number; userId: number; reason?: string | null }) {
  const contract = await requireContract(input.id)
  if (contract.subjectUserId !== input.userId) throw new HttpError('Contract not found', 404, 404)
  if (contract.status !== CONTRACT_STATUS.PENDING_SIGNATURE) {
    throw new HttpError('This contract is not awaiting your response', 409, 409)
  }
  const declinedAt = new Date()
  const declined = await prisma.contract.updateMany({
    where: {
      id: input.id,
      subjectUserId: input.userId,
      status: CONTRACT_STATUS.PENDING_SIGNATURE,
    },
    data: {
      status: CONTRACT_STATUS.DECLINED,
      declinedAt,
      declineReason: input.reason?.trim().slice(0, 500) || null,
      updatedAt: declinedAt,
    },
  })
  if (declined.count !== 1) {
    throw new HttpError('This contract is not awaiting your response', 409, 409)
  }
  return getUserContract(input.userId, input.id)
}

async function contractForEvidence(id: number) {
  const contract = await requireContract(id)
  if (contract.status !== CONTRACT_STATUS.SIGNED) {
    throw new HttpError('Only a signed contract can be anchored on chain', 409, 409)
  }
  const contractHash = await verifiedContractHash(contract)
  return { contract, contractHash }
}

async function failCredentialAttempt(
  attemptId: number,
  code: string,
  message: string,
  audit?: { actorUserId: number; action: string },
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
    if (audit) {
      const credential = await tx.contractCredential.findUnique({
        where: { id: attempt.credentialId },
        select: { contractId: true },
      })
      if (credential) {
        await tx.contractAdminAudit.create({
          data: {
            contractId: credential.contractId,
            actorUserId: audit.actorUserId,
            action: audit.action,
          },
        })
      }
    }
    return attempt
  })
}

export async function cancelContractEvidenceAttempt(input: {
  attemptId: number
  issuerUserId: number
  reason?: string
}) {
  const attempt = await prisma.contractCredentialAttempt.findUnique({
    where: { id: input.attemptId },
    select: { id: true, issuerUserId: true, status: true },
  })
  if (!attempt || attempt.issuerUserId !== input.issuerUserId) {
    throw new HttpError('Contract signing attempt not found', 404, 404)
  }
  if (attempt.status !== CONTRACT_CREDENTIAL_ATTEMPT_STATUS.PREPARED) {
    throw new HttpError('Only an unsigned contract evidence attempt can be cancelled', 409, 409)
  }
  await failCredentialAttempt(
    attempt.id,
    'WALLET_SIGNATURE_CANCELLED',
    input.reason || 'The administrator cancelled the wallet signature request',
    {
      actorUserId: input.issuerUserId,
      action: CONTRACT_ADMIN_AUDIT_ACTION.EVIDENCE_ATTEMPT_CANCELLED,
    },
  )
  return { attemptId: String(attempt.id), status: CONTRACT_CREDENTIAL_ATTEMPT_STATUS.FAILED }
}

export async function prepareContractEvidence(input: {
  contractId: number
  network: SolanaNetwork
  signerAddress: string
  issuerUserId: number
}) {
  await requireEnabledSolanaNetwork(input.network)
  const signer = parseSigner(input.signerAddress)
  const { contract, contractHash } = await contractForEvidence(input.contractId)
  const memo = canonicalContractEvidenceMemo({
    installationId: contract.installationId!,
    contractId: contract.contractId,
    contractHash,
    bodyHash: contract.bodyHash,
    attachmentHash: contract.attachmentHash,
    network: input.network,
    signer: signer.toBase58(),
  })
  const existing = await prisma.contractCredential.findUnique({
    where: { contractId_network: { contractId: contract.id, network: input.network } },
    include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })
  if (existing?.status === CONTRACT_CREDENTIAL_STATUS.FINALIZED) {
    throw new HttpError('This contract already has finalized evidence on the selected network', 409, 409)
  }
  if (existing?.status === CONTRACT_CREDENTIAL_STATUS.SUBMITTED) {
    await reconcileContractEvidence(existing.id)
    const current = await prisma.contractCredential.findUnique({ where: { id: existing.id } })
    if (current?.status !== CONTRACT_CREDENTIAL_STATUS.FAILED) {
      throw new HttpError('This contract already has a submitted evidence transaction', 409, 409)
    }
  }
  const latestAttempt = existing?.attempts[0]
  if (existing?.status === CONTRACT_CREDENTIAL_STATUS.PREPARED && latestAttempt && latestAttempt.expiresAt.getTime() > Date.now()) {
    throw new HttpError('A contract signing request is already active', 409, 409)
  }
  if (latestAttempt?.status === CONTRACT_CREDENTIAL_ATTEMPT_STATUS.PREPARED) {
    await failCredentialAttempt(latestAttempt.id, 'PREPARE_EXPIRED', 'The signing window expired')
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
      const transaction = buildMemoTransaction({
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
        transactionBase64: serializePreparedMemoTransaction(transaction),
        messageHash: memoTransactionMessageHash(transaction),
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
        feeLamports,
        balanceLamports: balance,
      }
    })
  } catch (error) {
    evidenceRpcError(error, 'prepare contract evidence')
  }

  const expiresAt = new Date(Date.now() + PREPARE_TTL_MS)
  try {
    const stored = await unitOfWork.execute(async (tx) => {
      const credential = existing
        ? await tx.contractCredential.update({
            where: { id: existing.id },
            data: {
              issuerUserId: input.issuerUserId,
              signerAddress: signer.toBase58(),
              memo,
              transactionSignature: null,
              status: CONTRACT_CREDENTIAL_STATUS.PREPARED,
              slot: null,
              blockTime: null,
              feeLamports: null,
              finalizedAt: null,
              lastVerifiedAt: null,
              updatedAt: new Date(),
            },
          })
        : await tx.contractCredential.create({
            data: {
              contractId: contract.id,
              issuerUserId: input.issuerUserId,
              network: input.network,
              signerAddress: signer.toBase58(),
              memo,
              status: CONTRACT_CREDENTIAL_STATUS.PREPARED,
            },
          })
      const attempt = await tx.contractCredentialAttempt.create({
        data: {
          credentialId: credential.id,
          issuerUserId: input.issuerUserId,
          signerAddress: signer.toBase58(),
          memo,
          messageHash: prepared.messageHash,
          recentBlockhash: prepared.blockhash,
          lastValidBlockHeight: BigInt(prepared.lastValidBlockHeight),
          expiresAt,
          status: CONTRACT_CREDENTIAL_ATTEMPT_STATUS.PREPARED,
        },
      })
      await tx.contractAdminAudit.create({
        data: {
          contractId: contract.id,
          actorUserId: input.issuerUserId,
          action: CONTRACT_ADMIN_AUDIT_ACTION.EVIDENCE_PREPARED,
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
      title: contract.title,
      contractId: contract.contractId,
      contractHash,
      network: input.network,
    }
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) throw new HttpError('This contract already has evidence on the selected network', 409, 409)
    throw error
  }
}

function credentialResult(credential: { id: number; transactionSignature: string | null; status: number; network: string }) {
  return {
    credentialId: String(credential.id),
    transactionSignature: credential.transactionSignature,
    status: credential.status,
    network: credential.network,
  }
}

export async function submitContractEvidence(input: {
  attemptId: number
  signedTransactionBase64: string
  issuerUserId: number
}) {
  const attempt = await prisma.contractCredentialAttempt.findUnique({
    where: { id: input.attemptId },
    include: { credential: true },
  })
  if (!attempt || attempt.issuerUserId !== input.issuerUserId) throw new HttpError('Contract signing attempt not found', 404, 404)
  if (attempt.status === CONTRACT_CREDENTIAL_ATTEMPT_STATUS.FINALIZED) return credentialResult(attempt.credential)
  if (attempt.status === CONTRACT_CREDENTIAL_ATTEMPT_STATUS.SUBMITTED) {
    return credentialResult(await reconcileContractEvidence(attempt.credentialId, input.issuerUserId))
  }
  if (attempt.status === CONTRACT_CREDENTIAL_ATTEMPT_STATUS.FAILED) throw new HttpError('Contract signing attempt has failed; prepare a new one', 409, 409)
  if (attempt.credential.status === CONTRACT_CREDENTIAL_STATUS.FINALIZED) throw new HttpError('This contract already has finalized evidence on the selected network', 409, 409)
  const latest = await prisma.contractCredentialAttempt.findFirst({
    where: { credentialId: attempt.credentialId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (latest?.id !== attempt.id || attempt.credential.status !== CONTRACT_CREDENTIAL_STATUS.PREPARED) {
    throw new HttpError('This contract signing attempt is no longer active', 409, 409)
  }
  if (attempt.expiresAt.getTime() <= Date.now()) {
    await failCredentialAttempt(attempt.id, 'PREPARE_EXPIRED', 'The signing window expired')
    throw new HttpError('Contract signing request expired', 409, 409)
  }
  const transaction = parseSignedMemoTransaction(input.signedTransactionBase64)
  const signature = assertSignedMemoTransaction({
    transaction,
    memo: attempt.memo,
    signerAddress: attempt.signerAddress,
    messageHash: attempt.messageHash,
  })
  try {
    await unitOfWork.execute(async (tx) => {
      await tx.contractCredentialAttempt.update({
        where: { id: attempt.id },
        data: {
          transactionSignature: signature,
          status: CONTRACT_CREDENTIAL_ATTEMPT_STATUS.SUBMITTED,
          submittedAt: new Date(),
          failureCode: null,
          failureMessage: null,
          updatedAt: new Date(),
        },
      })
      await tx.contractCredential.update({
        where: { id: attempt.credentialId },
        data: { transactionSignature: signature, status: CONTRACT_CREDENTIAL_STATUS.SUBMITTED, updatedAt: new Date() },
      })
      await tx.contractAdminAudit.create({
        data: {
          contractId: attempt.credential.contractId,
          actorUserId: input.issuerUserId,
          action: CONTRACT_ADMIN_AUDIT_ACTION.EVIDENCE_SUBMITTED,
        },
      })
    })
  } catch (error) {
    if (hasPrismaCode(error, 'P2002')) throw new HttpError('Transaction signature is already assigned to another contract credential', 409, 409)
    throw error
  }
  try {
    const submitted = await withEvidenceRpc(
      attempt.credential.network as SolanaNetwork,
      (connection) => connection.sendRawTransaction(transaction.serialize(), {
        maxRetries: 3,
        preflightCommitment: 'confirmed',
      }),
    )
    if (submitted !== signature) throw new HttpError('RPC returned an unexpected transaction signature', 502, 502)
  } catch (error) {
    if (isEvidenceRpcConnectionFailure(error)) {
      console.warn('[contract-evidence] Submission outcome is unknown; reconciliation retained', error)
    } else {
      await failCredentialAttempt(
        attempt.id,
        'CHAIN_SUBMISSION_FAILED',
        error instanceof Error ? error.message : 'Solana rejected the transaction submission',
      )
      evidenceRpcError(error, 'submit contract evidence')
    }
  }
  return credentialResult(await reconcileContractEvidence(attempt.credentialId, input.issuerUserId))
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
  if (!input.isAdmin && (contract.subjectUserId !== input.userId || contract.status === CONTRACT_STATUS.DRAFT)) {
    throw new HttpError('Contract not found', 404, 404)
  }
  if (!contract.attachmentFileId) throw new HttpError('Contract attachment not found', 404, 404)
  const { file, buffer } = await readManagedFile(contract.attachmentFileId)
  if (file.businessType !== 'ContractAttachment') throw new HttpError('Contract attachment metadata is invalid', 409, 409)
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
