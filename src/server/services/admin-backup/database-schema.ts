/**
 * @file database-schema.ts
 * @project SlothVault
 * @module Admin Database Backup Schema
 * @description Defines the portable 2.5 database-backup shape with contract, project-version, and note-content evidence plus legacy cNFT input compatibility.
 * @logic Validate active collections strictly, retain stable note evidence identities and frozen evidence attempts, accept deprecated Tree/cNFT arrays only for ignore accounting, and retain prior import envelopes.
 * @dependencies Zod, Node path rules, backup constants
 * @index_tags admin,backup,database,schema,zod,portable
 * @author holic512
 */
import 'server-only'

import { isAbsolute } from 'node:path'

import { z } from 'zod'

import {
  DATABASE_BIGINT_MAX,
  DATABASE_RECORD_LIMIT,
  INT_MAX,
  INT_MIN,
  SMALL_INT_MAX,
  SMALL_INT_MIN,
} from './constants'

function limitedString(maxLength: number) {
  return z.string().max(maxLength)
}

function nonEmptyString(maxLength: number) {
  return z.string().min(1).max(maxLength)
}

function nullableString(maxLength: number) {
  return z.string().max(maxLength).nullable()
}

function isValidIsoTimestamp(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(
    value,
  )
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = match[8] === undefined ? 0 : Number(match[8])
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9])
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate()

  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= maxDay &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(new Date(value).getTime())
  )
}

const dateStringSchema = z.string().refine(isValidIsoTimestamp, 'Invalid ISO date')

function isDatabaseBigInt(value: string, positive: boolean) {
  const pattern = positive ? /^[1-9]\d*$/ : /^(?:0|[1-9]\d*)$/
  if (!pattern.test(value) || value.length > 19) return false
  return BigInt(value) <= DATABASE_BIGINT_MAX
}

const idStringSchema = z.string().refine(
  (value) => isDatabaseBigInt(value, true),
  'Expected a positive decimal-string ID',
)
const bigintStringSchema = z.string().refine(
  (value) => isDatabaseBigInt(value, false),
  'Expected a non-negative 64-bit integer string',
)
const nullableIdStringSchema = idStringSchema.nullable()
const intSchema = z.number().int().min(INT_MIN).max(INT_MAX)
const smallIntSchema = z.number().int().min(SMALL_INT_MIN).max(SMALL_INT_MAX)

const storedFilePathSchema = limitedString(500).refine((value) => {
  if (
    value.includes('\0') ||
    value.includes('\\') ||
    isAbsolute(value) ||
    !value.startsWith('uploads/')
  ) {
    return false
  }
  const segments = value.slice('uploads/'.length).split('/')
  return (
    segments.length >= 2 &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment !== '.' &&
        segment !== '..' &&
        !segment.startsWith('.'),
    )
  )
}, 'Invalid managed file path')

const userSchema = z.object({
  id: idStringSchema,
  username: nonEmptyString(255),
  password: nonEmptyString(255),
  passwordConfigured: z.boolean().optional().default(true),
  email: nullableString(255),
  displayName: nullableString(80).optional().default(null),
  avatar: nullableString(500).optional().default(null),
  bio: z.string().nullable().optional().default(null),
  role: z.enum(['ADMIN', 'USER']).optional().default('USER'),
  status: smallIntSchema.optional().default(1),
  pointsBalance: intSchema.optional().default(0),
  walletAddress: nullableString(64).optional().default(null),
  lastLoginAt: dateStringSchema.nullable().optional().default(null),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
}).strict()

const pointTransactionSchema = z.object({
  id: idStringSchema,
  userId: idStringSchema,
  amount: intSchema,
  balanceAfter: intSchema,
  type: nonEmptyString(40),
  referenceId: nullableString(128),
  description: nullableString(255),
  createdAt: dateStringSchema,
}).strict()

const giftCardBatchSchema = z.object({
  id: idStringSchema,
  name: nonEmptyString(128),
  points: intSchema.positive(),
  quantity: intSchema.positive(),
  expiresAt: dateStringSchema.nullable(),
  status: smallIntSchema,
  createdById: idStringSchema,
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
}).strict()

const giftCardSchema = z.object({
  id: idStringSchema,
  batchId: idStringSchema,
  codeHash: z.string().regex(/^[a-f0-9]{64}$/),
  codeHint: nonEmptyString(24),
  status: smallIntSchema,
  redeemedById: nullableIdStringSchema,
  redeemedAt: dateStringSchema.nullable(),
  createdAt: dateStringSchema,
}).strict()

const projectSchema = z.object({
  id: idStringSchema,
  projectName: limitedString(128),
  avatar: nullableString(500),
  weight: intSchema,
  status: smallIntSchema,
  requireAuth: z.boolean(),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
  isDeleted: z.boolean(),
}).strict()

const projectVersionSchema = z.object({
  id: idStringSchema,
  projectId: idStringSchema,
  version: limitedString(64),
  description: z.string().nullable(),
  weight: intSchema,
  status: smallIntSchema,
  releaseId: z.string().uuid().nullable().optional().default(null),
  releaseHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional().default(null),
  manifestVersion: z.literal(1).nullable().optional().default(null),
  publishedAt: dateStringSchema.nullable().optional().default(null),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
  isDeleted: z.boolean(),
}).strict()

const categorySchema = z.object({
  id: idStringSchema,
  projectVersionId: idStringSchema,
  categoryName: limitedString(64),
  weight: intSchema,
  status: smallIntSchema,
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
  isDeleted: z.boolean(),
}).strict()

const projectMenuSchema = z.object({
  id: idStringSchema,
  projectId: idStringSchema,
  parentId: nullableIdStringSchema,
  label: limitedString(64),
  url: nullableString(2048),
  isExternal: z.boolean(),
  weight: intSchema,
  status: smallIntSchema,
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
  isDeleted: z.boolean(),
}).strict()

const projectHomeSchema = z.object({
  id: idStringSchema,
  projectId: idStringSchema,
  content: z.string(),
  status: smallIntSchema,
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
  isDeleted: z.boolean(),
}).strict()

const noteInfoSchema = z.object({
  id: idStringSchema,
  categoryId: idStringSchema,
  authorId: nullableIdStringSchema.optional(),
  noteTitle: limitedString(255),
  weight: intSchema,
  status: smallIntSchema,
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
  isDeleted: z.boolean(),
}).strict()

const noteContentSchema = z.object({
  id: idStringSchema,
  noteInfoId: idStringSchema,
  evidenceId: z.string().uuid().nullable().optional().default(null),
  content: z.string(),
  versionNote: nullableString(255),
  isPrimary: z.boolean(),
  status: smallIntSchema,
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
  isDeleted: z.boolean(),
}).strict()

const fileManagementSchema = z.object({
  id: idStringSchema,
  originalName: limitedString(255),
  fileName: limitedString(255),
  filePath: storedFilePathSchema,
  fileSize: bigintStringSchema,
  businessType: limitedString(50),
  status: smallIntSchema,
  createTime: dateStringSchema,
}).strict()

const systemConfigSchema = z.object({
  id: idStringSchema,
  configKey: nonEmptyString(100),
  configValue: limitedString(500),
  description: nullableString(255),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
}).strict()

const systemHomepageSchema = z.object({
  id: idStringSchema,
  content: z.string(),
  status: smallIntSchema,
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
  isDeleted: z.boolean(),
}).strict()

const merkleTreeSchema = z.object({
  id: idStringSchema,
  name: limitedString(128),
  treeAddress: nonEmptyString(64),
  treeAuthority: limitedString(64),
  encryptedKey: z.string(),
  creatorAddress: limitedString(64),
  maxDepth: smallIntSchema,
  maxBufferSize: smallIntSchema,
  canopyDepth: smallIntSchema,
  network: z.enum(['mainnet', 'devnet']),
  totalMinted: intSchema,
  maxCapacity: bigintStringSchema,
  remainingCapacity: bigintStringSchema.optional(),
  capacityRevision: intSchema.nonnegative().optional(),
  creationCost: bigintStringSchema,
  txSignature: nullableString(128),
  priority: intSchema,
  status: z.union([z.literal(-1), z.literal(0), z.literal(1), z.literal(2)]),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
  isDeleted: z.boolean(),
}).strict()

const compressedNftSchema = z.object({
  id: idStringSchema,
  merkleTreeId: idStringSchema,
  projectId: idStringSchema,
  noteInfoId: nullableIdStringSchema.optional(),
  copyrightOwnerId: nullableIdStringSchema.optional(),
  assetId: nonEmptyString(64),
  leafIndex: intSchema,
  name: limitedString(128),
  symbol: nullableString(32),
  description: z.string().nullable(),
  metadataUri: nullableString(500),
  imageCid: nullableString(128),
  metadataCid: nullableString(128),
  originalImageId: nullableIdStringSchema,
  ownerAddress: limitedString(64),
  mintTxSignature: nullableString(128),
  prepareExpiresAt: dateStringSchema.nullable().optional(),
  lastValidBlockHeight: bigintStringSchema.nullable().optional(),
  capacityReserved: z.boolean().optional(),
  status: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
}).strict()

const releaseCredentialSchema = z.object({
  id: idStringSchema,
  projectVersionId: idStringSchema,
  noteContentId: nullableIdStringSchema.optional().default(null),
  issuerUserId: idStringSchema,
  subjectType: z.enum(['PROJECT_VERSION', 'NOTE_CONTENT']).optional().default('PROJECT_VERSION'),
  subjectId: z.string().uuid().nullable().optional().default(null),
  subjectHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional().default(null),
  subjectManifestVersion: intSchema.positive().nullable().optional().default(null),
  network: z.enum(['mainnet', 'devnet']),
  signerAddress: nonEmptyString(64),
  memo: z.string(),
  transactionSignature: nullableString(128),
  status: z.union([z.literal(-1), z.literal(0), z.literal(1), z.literal(2)]),
  slot: bigintStringSchema.nullable(),
  blockTime: dateStringSchema.nullable(),
  feeLamports: bigintStringSchema.nullable(),
  finalizedAt: dateStringSchema.nullable(),
  lastVerifiedAt: dateStringSchema.nullable(),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
}).strict()

const releaseCredentialAttemptSchema = z.object({
  id: idStringSchema,
  credentialId: idStringSchema,
  issuerUserId: idStringSchema,
  signerAddress: nonEmptyString(64),
  memo: z.string(),
  messageHash: z.string().regex(/^[a-f0-9]{64}$/),
  recentBlockhash: nonEmptyString(100),
  lastValidBlockHeight: bigintStringSchema,
  transactionSignature: nullableString(128),
  status: z.union([z.literal(-1), z.literal(0), z.literal(1), z.literal(2)]),
  failureCode: nullableString(64),
  failureMessage: nullableString(500),
  expiresAt: dateStringSchema,
  submittedAt: dateStringSchema.nullable(),
  finalizedAt: dateStringSchema.nullable(),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
}).strict()

const contractSchema = z.object({
  id: idStringSchema,
  contractId: z.string().uuid(),
  installationId: z.string().uuid().nullable(),
  issuerUserId: idStringSchema,
  subjectUserId: idStringSchema,
  title: nonEmptyString(255),
  body: z.string().min(1).max(100_000),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  contractHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  attachmentFileId: nullableIdStringSchema,
  attachmentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  partyCommitment: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.union([z.literal(-2), z.literal(-1), z.literal(0), z.literal(1), z.literal(2)]),
  issuedAt: dateStringSchema.nullable(),
  signedAt: dateStringSchema.nullable(),
  signedSessionId: z.string().uuid().nullable(),
  signedIp: nullableString(255),
  signedUserAgent: nullableString(4_000),
  declinedAt: dateStringSchema.nullable(),
  declineReason: nullableString(500),
  cancelledAt: dateStringSchema.nullable(),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
}).strict()

const contractCredentialSchema = z.object({
  id: idStringSchema,
  contractId: idStringSchema,
  issuerUserId: idStringSchema,
  network: z.enum(['mainnet', 'devnet']),
  signerAddress: nonEmptyString(64),
  memo: z.string(),
  transactionSignature: nullableString(128),
  status: z.union([z.literal(-1), z.literal(0), z.literal(1), z.literal(2)]),
  slot: bigintStringSchema.nullable(),
  blockTime: dateStringSchema.nullable(),
  feeLamports: bigintStringSchema.nullable(),
  finalizedAt: dateStringSchema.nullable(),
  lastVerifiedAt: dateStringSchema.nullable(),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
}).strict()

const contractCredentialAttemptSchema = z.object({
  id: idStringSchema,
  credentialId: idStringSchema,
  issuerUserId: idStringSchema,
  signerAddress: nonEmptyString(64),
  memo: z.string(),
  messageHash: z.string().regex(/^[a-f0-9]{64}$/),
  recentBlockhash: nonEmptyString(100),
  lastValidBlockHeight: bigintStringSchema,
  transactionSignature: nullableString(128),
  status: z.union([z.literal(-1), z.literal(0), z.literal(1), z.literal(2)]),
  failureCode: nullableString(64),
  failureMessage: nullableString(500),
  expiresAt: dateStringSchema,
  submittedAt: dateStringSchema.nullable(),
  finalizedAt: dateStringSchema.nullable(),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
}).strict()

const contractAdminAuditSchema = z.object({
  id: idStringSchema,
  contractId: idStringSchema,
  actorUserId: idStringSchema,
  action: nonEmptyString(64),
  createdAt: dateStringSchema,
}).strict()

export const backupDataSchema = z.object({
  users: z.array(userSchema).max(DATABASE_RECORD_LIMIT).default([]),
  pointTransactions: z.array(pointTransactionSchema).max(DATABASE_RECORD_LIMIT).default([]),
  giftCardBatches: z.array(giftCardBatchSchema).max(DATABASE_RECORD_LIMIT).default([]),
  giftCards: z.array(giftCardSchema).max(DATABASE_RECORD_LIMIT).default([]),
  projects: z.array(projectSchema).max(DATABASE_RECORD_LIMIT),
  projectVersions: z.array(projectVersionSchema).max(DATABASE_RECORD_LIMIT),
  categories: z.array(categorySchema).max(DATABASE_RECORD_LIMIT),
  projectMenus: z.array(projectMenuSchema).max(DATABASE_RECORD_LIMIT),
  projectHomes: z.array(projectHomeSchema).max(DATABASE_RECORD_LIMIT),
  noteInfos: z.array(noteInfoSchema).max(DATABASE_RECORD_LIMIT),
  noteContents: z.array(noteContentSchema).max(DATABASE_RECORD_LIMIT),
  fileManagements: z.array(fileManagementSchema).max(DATABASE_RECORD_LIMIT),
  systemConfigs: z.array(systemConfigSchema).max(DATABASE_RECORD_LIMIT),
  systemHomepages: z.array(systemHomepageSchema).max(DATABASE_RECORD_LIMIT),
  contracts: z.array(contractSchema).max(DATABASE_RECORD_LIMIT).default([]),
  contractAdminAudits: z.array(contractAdminAuditSchema).max(DATABASE_RECORD_LIMIT).default([]),
  contractCredentials: z.array(contractCredentialSchema).max(DATABASE_RECORD_LIMIT).default([]),
  contractCredentialAttempts: z.array(contractCredentialAttemptSchema).max(DATABASE_RECORD_LIMIT).default([]),
  releaseCredentials: z.array(releaseCredentialSchema).max(DATABASE_RECORD_LIMIT).default([]),
  releaseCredentialAttempts: z.array(releaseCredentialAttemptSchema).max(DATABASE_RECORD_LIMIT).default([]),
  merkleTrees: z.array(merkleTreeSchema).max(DATABASE_RECORD_LIMIT).optional().default([]),
  compressedNfts: z.array(compressedNftSchema).max(DATABASE_RECORD_LIMIT).optional().default([]),
}).strict()

export const databaseImportPayloadSchema = z.object({
  data: backupDataSchema,
  mode: z.enum(['insert', 'overwrite']).optional().default('insert'),
  version: z.enum(['2.0.0', '2.1.0', '2.2.0', '2.3.0', '2.4.0', '2.5.0']).optional().default('2.0.0'),
}).strict()

export type BackupData = z.infer<typeof backupDataSchema>
export type DatabaseImportPayload = z.infer<typeof databaseImportPayloadSchema>
