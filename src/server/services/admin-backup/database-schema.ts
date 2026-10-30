/**
 * @file database-schema.ts
 * @project SlothVault
 * @module Admin Database Backup Schema
 * @description Defines the portable 2.21 database-backup shape with permanent public content identities and legacy link aliases.
 * @logic Validate active collections strictly, retain v3 publication snapshots, note tags, member access and standalone blog content, include source documentation baselines, multi-wallet bindings and username quotas, and require the current data version and full overwrite restoration.
 * @dependencies Zod, Node path rules, backup constants
 * @index_tags admin,backup,database,schema,zod,portable
 * @author holic512
 */
import 'server-only'
import { pluginBackupShape } from '@/server/plugins/backup'
import { readDocumentationState } from '@/lib/project-documentation'
import { attributionJsonSchema, userIdentitySchema } from '@/lib/user-attribution'

import { isAbsolute } from 'node:path'

import { z } from 'zod'
import { noteTagsSchema } from '@/lib/note-tags'
import { projectMenuIconKeys } from '@/lib/project-menu-icons'
import { publicContentIdPattern } from '@/lib/public-content-id'

import {
  DATABASE_BIGINT_MAX,
  DATABASE_BACKUP_VERSION,
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
const publicIdentityFields = {
  publicId: z.string().regex(publicContentIdPattern),
  legacyUrlId: z.string().regex(/^[1-9]\d*$/).refine(value => Number(value) <= INT_MAX).nullable(),
}
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
  usernameChangeMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable().default(null),
  usernameChangeCount: z.number().int().min(0).max(3).default(0),
  credentialsRevision: z.number().int().min(0).max(2_147_483_647).default(0),
  lastLoginAt: dateStringSchema.nullable().optional().default(null),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
}).strict()

const pointTransactionSchema = z.object({
  attributionJson: attributionJsonSchema,
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
  attributionJson: attributionJsonSchema,
  id: idStringSchema,
  name: nonEmptyString(128),
  points: intSchema.positive(),
  quantity: intSchema.positive(),
  expiresAt: dateStringSchema.nullable(),
  status: smallIntSchema,
  createdById: nullableIdStringSchema,
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

const membershipLevelSchema = z.object({
  id: idStringSchema,
  name: nonEmptyString(80),
  rank: z.number().int().min(1).max(SMALL_INT_MAX),
  pricePoints: intSchema.positive(),
  validityDays: z.number().int().min(1).max(36_500).nullable(),
  status: z.union([z.literal(0), z.literal(1)]),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
}).strict()

const membershipGrantSchema = z.object({
  attributionJson: attributionJsonSchema,
  id: idStringSchema,
  userId: idStringSchema,
  membershipLevelId: idStringSchema,
  source: z.enum(['POINT_PURCHASE', 'ADMIN_GRANT']),
  pointsCost: intSchema.positive().nullable(),
  grantedByUserId: nullableIdStringSchema,
  grantedAt: dateStringSchema,
  expiresAt: dateStringSchema.nullable(),
  revokedAt: dateStringSchema.nullable(),
  revokedByUserId: nullableIdStringSchema,
}).strict()

const articleCoverSchema = z.string()
  .max(500)
  .regex(
    /^\/uploads\/article-cover\/[0-9a-f-]+\.(?:gif|jpe?g|png|webp)$/i,
    'Invalid managed article-cover path',
  )
  .nullable()

const articleSchema = z.object({
  ...publicIdentityFields,
  id: idStringSchema,
  title: nonEmptyString(255),
  summary: nullableString(500),
  cover: articleCoverSchema,
  content: z.string().max(500_000),
  status: z.union([z.literal(0), z.literal(1)]),
  requiredMembershipLevelId: nullableIdStringSchema.optional().default(null),
  allowedMembershipLevelIds: z.array(idStringSchema).max(1000).optional().default([]),
  publishedAt: dateStringSchema.nullable(),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
  isDeleted: z.boolean(),
  deletedAt: dateStringSchema.nullable().optional(),
}).strict()

const projectSchema = z.object({
  ...publicIdentityFields,
  id: idStringSchema,
  projectName: limitedString(128),
  avatar: nullableString(500),
  weight: intSchema,
  status: smallIntSchema,
  requireAuth: z.boolean(),
  readAccessMode: z.enum(['PUBLIC', 'LOGIN', 'MEMBERSHIPS']).optional().default('PUBLIC'),
  downloadAccessMode: z.enum(['FOLLOW_READ', 'LOGIN', 'MEMBERSHIPS', 'DISABLED']).optional().default('FOLLOW_READ'),
  readMembershipLevelIds: z.array(idStringSchema).max(1000).optional().default([]),
  downloadMembershipLevelIds: z.array(idStringSchema).max(1000).optional().default([]),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
  isDeleted: z.boolean(),
  deletedAt: dateStringSchema.nullable().optional(),
}).strict()

const projectVersionSchema = z.object({
  ...publicIdentityFields,
  id: idStringSchema,
  projectId: idStringSchema,
  version: limitedString(64),
  description: z.string().nullable(),
  weight: intSchema,
  status: smallIntSchema,
  releaseId: z.string().uuid().nullable().optional().default(null),
  releaseHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional().default(null),
  releaseManifestJson: z.string().nullable().optional().default(null),
  documentationStateJson: z.string().max(2 * 1024 * 1024).nullable().optional().default(null).superRefine((raw, ctx) => {
    if (raw === null) return
    try { readDocumentationState(raw) } catch { ctx.addIssue({ code: 'custom', message: 'Invalid documentation metadata.' }) }
  }),
  manifestVersion: z.literal(3).nullable().optional().default(null),
  publishedAt: dateStringSchema.nullable().optional().default(null),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
  isDeleted: z.boolean(),
  deletedAt: dateStringSchema.nullable().optional(),
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
  deletedAt: dateStringSchema.nullable().optional(),
}).strict()

const projectMenuSchema = z.object({
  id: idStringSchema,
  projectId: idStringSchema,
  parentId: nullableIdStringSchema,
  label: limitedString(64),
  icon: z.enum(projectMenuIconKeys).nullable(),
  url: nullableString(2048),
  isExternal: z.boolean(),
  weight: intSchema,
  status: smallIntSchema,
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
  isDeleted: z.boolean(),
  deletedAt: dateStringSchema.nullable().optional(),
}).strict()

export const legacyProjectMenuSchema = projectMenuSchema.omit({ icon: true })

const projectHomeSchema = z.object({
  id: idStringSchema,
  projectId: idStringSchema,
  content: z.string(),
  status: smallIntSchema,
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
  isDeleted: z.boolean(),
  deletedAt: dateStringSchema.nullable().optional(),
}).strict()

const noteInfoSchema = z.object({
  ...publicIdentityFields,
  attributionJson: attributionJsonSchema,
  id: idStringSchema,
  categoryId: idStringSchema,
  authorId: nullableIdStringSchema.optional(),
  noteTitle: limitedString(255),
  tags: noteTagsSchema.optional().default([]),
  weight: intSchema,
  status: smallIntSchema,
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
  isDeleted: z.boolean(),
  deletedAt: dateStringSchema.nullable().optional(),
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
  deletedAt: dateStringSchema.nullable().optional(),
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

const releaseCredentialSchema = z.object({
  attributionJson: attributionJsonSchema,
  id: idStringSchema,
  projectVersionId: idStringSchema,
  noteContentId: nullableIdStringSchema.optional().default(null),
  issuerUserId: nullableIdStringSchema,
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
  attributionJson: attributionJsonSchema,
  id: idStringSchema,
  credentialId: idStringSchema,
  issuerUserId: nullableIdStringSchema,
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

const fileReferenceSchema = z.object({
  id: idStringSchema,
  fileId: idStringSchema,
  sourceType: z.enum(['NOTE_CONTENT', 'PROJECT_HOME', 'PROJECT_MENU', 'ARTICLE', 'SYSTEM_HOMEPAGE', 'PROJECT_AVATAR', 'USER_AVATAR', 'SYSTEM_CONFIG']),
  sourceId: idStringSchema,
  projectId: nullableIdStringSchema,
  usage: z.enum(['READ_MEDIA', 'DOWNLOAD']),
}).strict()

const identityJsonSchema = z.string().max(2048).refine(value => {
  try { return userIdentitySchema.safeParse(JSON.parse(value)).success } catch { return false }
}, 'Invalid historical identity')
const deletionSummarySchema = z.object({ cleanup: z.record(z.string(), z.number().int().nonnegative()), retained: z.record(z.string(), z.number().int().nonnegative()) }).strict()
const userDeletionRecordSchema = z.object({
  id: idStringSchema, publicId: z.string().uuid(), username: nonEmptyString(255),
  userSnapshotJson: identityJsonSchema, actorSnapshotJson: identityJsonSchema,
  summaryJson: z.string().max(20000).refine(value => { try { return deletionSummarySchema.safeParse(JSON.parse(value)).success } catch { return false } }),
  userCreatedAt: dateStringSchema, deletedAt: dateStringSchema,
}).strict()

export const backupDataSchema = z.object({
  ...pluginBackupShape,
  users: z.array(userSchema).default([]),
  userWallets: z.array(z.object({ id: idStringSchema, userId: idStringSchema, address: nonEmptyString(64), createdAt: dateStringSchema }).strict()).default([]),
  userDeletionRecords: z.array(userDeletionRecordSchema).default([]),
  pointTransactions: z.array(pointTransactionSchema).default([]),
  giftCardBatches: z.array(giftCardBatchSchema).default([]),
  giftCards: z.array(giftCardSchema).default([]),
  membershipLevels: z.array(membershipLevelSchema).optional().default([]),
  membershipGrants: z.array(membershipGrantSchema).optional().default([]),
  articles: z.array(articleSchema).optional().default([]),
  projects: z.array(projectSchema),
  projectVersions: z.array(projectVersionSchema),
  categories: z.array(categorySchema),
  projectMenus: z.array(projectMenuSchema),
  projectHomes: z.array(projectHomeSchema),
  noteInfos: z.array(noteInfoSchema),
  noteContents: z.array(noteContentSchema),
  fileReferences: z.array(fileReferenceSchema).optional().default([]),
  fileManagements: z.array(fileManagementSchema),
  systemConfigs: z.array(systemConfigSchema),
  systemHomepages: z.array(systemHomepageSchema),
  releaseCredentials: z.array(releaseCredentialSchema).default([]),
  releaseCredentialAttempts: z.array(releaseCredentialAttemptSchema).default([]),
}).strict()

export const databaseImportPayloadSchema = z.object({
  data: backupDataSchema,
  mode: z.literal('overwrite'),
  version: z.literal(DATABASE_BACKUP_VERSION),
}).strict()

export type BackupData = z.infer<typeof backupDataSchema>
export type DatabaseImportPayload = z.infer<typeof databaseImportPayloadSchema>
