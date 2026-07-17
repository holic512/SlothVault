/**
 * @file admin-backup.ts
 * @project SlothVault
 * @module Admin Backup and Recovery
 * @description Provides relation-closed database snapshots, strict backup validation, atomic business-data restore/reset, and ZIP staging workflows for the configured upload storage.
 * @logic Read active business records from one repeatable snapshot while excluding orphaned descendants, validate complete backups before mutation, import relational data in one transaction with old-to-new ID maps, normalize note primaries, and commit filesystem changes only after contained staging succeeds with rollback paths available.
 * @dependencies Prisma business models, admin file UPLOAD_ROOT, archiver, unzipper, node filesystem and stream APIs, zod
 * @index_tags admin,backup,restore,transaction,zip,zip-slip,rollback,system-reset
 * @author holic512
 */
import 'server-only'

import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  link,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
} from 'node:fs/promises'
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { Prisma } from '@generated/prisma/client'
import archiver from 'archiver'
import unzipper, { type File as ZipEntry } from 'unzipper'
import { z } from 'zod'

import { HttpError } from '@/server/http/errors'
import { toJsonSafe } from '@/server/http/response'
import { prisma } from '@/server/prisma'
import {
  BUSINESS_TYPE_CONFIG,
  UPLOAD_ROOT,
} from '@/server/services/admin-files'

export const DATABASE_IMPORT_CONTENT_LENGTH_MAX_BYTES = 50 * 1024 * 1024
export const DATABASE_RECORD_LIMIT = 100_000
export const FILES_IMPORT_CONTENT_LENGTH_MAX_BYTES = 260 * 1024 * 1024
export const ZIP_FILE_MAX_BYTES = 250 * 1024 * 1024
export const ZIP_ENTRY_LIMIT = 10_000
export const ZIP_ENTRY_MAX_BYTES = 256 * 1024 * 1024
export const ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES = 1024 * 1024 * 1024
export const ZIP_PATH_MAX_BYTES = 1024

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n
const INT_MIN = -2_147_483_648
const INT_MAX = 2_147_483_647
const SMALL_INT_MIN = -32_768
const SMALL_INT_MAX = 32_767
const DATABASE_TRANSACTION_TIMEOUT_MS = 10 * 60 * 1000
const DATABASE_TRANSACTION_MAX_WAIT_MS = 10_000
const STANDARD_RESET_DIRECTORIES = [
  ...new Set(Object.values(BUSINESS_TYPE_CONFIG).map((config) => config.dir)),
]

const BACKUP_COLLECTION_KEYS = [
  'projects',
  'projectVersions',
  'categories',
  'projectMenus',
  'projectHomes',
  'noteInfos',
  'noteContents',
  'fileManagements',
  'systemConfigs',
  'systemHomepages',
  'merkleTrees',
  'compressedNfts',
] as const

export type ImportMode = 'insert' | 'overwrite'

function nodeErrorHasCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}

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

function isPostgresBigInt(value: string, positive: boolean) {
  const pattern = positive ? /^[1-9]\d*$/ : /^(?:0|[1-9]\d*)$/
  if (!pattern.test(value) || value.length > 19) return false
  return BigInt(value) <= POSTGRES_BIGINT_MAX
}

const idStringSchema = z.string().refine(
  (value) => isPostgresBigInt(value, true),
  'Expected a positive decimal-string ID',
)
const bigintStringSchema = z.string().refine(
  (value) => isPostgresBigInt(value, false),
  'Expected a non-negative PostgreSQL BigInt string',
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
  network: limitedString(20),
  totalMinted: intSchema,
  maxCapacity: bigintStringSchema,
  creationCost: bigintStringSchema,
  txSignature: nullableString(128),
  priority: intSchema,
  status: smallIntSchema,
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
  isDeleted: z.boolean(),
}).strict()

const compressedNftSchema = z.object({
  id: idStringSchema,
  merkleTreeId: idStringSchema,
  projectId: idStringSchema,
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
  status: smallIntSchema,
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
}).strict()

const backupDataSchema = z.object({
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
  merkleTrees: z.array(merkleTreeSchema).max(DATABASE_RECORD_LIMIT),
  compressedNfts: z.array(compressedNftSchema).max(DATABASE_RECORD_LIMIT),
}).strict()

const databaseImportPayloadSchema = z.object({
  data: backupDataSchema,
  mode: z.enum(['insert', 'overwrite']).optional().default('insert'),
}).strict()

export type BackupData = z.infer<typeof backupDataSchema>
export type DatabaseImportPayload = z.infer<typeof databaseImportPayloadSchema>

function invalidBackup(message: string): never {
  throw new HttpError(`Invalid backup data: ${message}`, 400, 400)
}

function mapById<T extends { id: string }>(label: string, items: T[]) {
  const result = new Map<string, T>()
  for (const item of items) {
    if (result.has(item.id)) invalidBackup(`duplicate ${label} id ${item.id}`)
    result.set(item.id, item)
  }
  return result
}

function assertUniqueField<T>(
  label: string,
  items: T[],
  valueOf: (item: T) => string,
) {
  const values = new Set<string>()
  for (const item of items) {
    const value = valueOf(item)
    if (values.has(value)) invalidBackup(`duplicate ${label} ${value}`)
    values.add(value)
  }
}

function assertReference<T>(
  index: Map<string, T>,
  id: string,
  label: string,
) {
  if (!index.has(id)) invalidBackup(`unknown ${label} ${id}`)
}

function validateBackupRelations(data: BackupData) {
  const totalRecords = BACKUP_COLLECTION_KEYS.reduce(
    (total, key) => total + data[key].length,
    0,
  )
  if (totalRecords > DATABASE_RECORD_LIMIT) {
    invalidBackup(`record count exceeds ${DATABASE_RECORD_LIMIT}`)
  }

  const projects = mapById('project', data.projects)
  const projectVersions = mapById('projectVersion', data.projectVersions)
  const categories = mapById('category', data.categories)
  const projectMenus = mapById('projectMenu', data.projectMenus)
  const projectHomes = mapById('projectHome', data.projectHomes)
  const noteInfos = mapById('noteInfo', data.noteInfos)
  mapById('noteContent', data.noteContents)
  const fileManagements = mapById('fileManagement', data.fileManagements)
  mapById('systemConfig', data.systemConfigs)
  mapById('systemHomepage', data.systemHomepages)
  const merkleTrees = mapById('merkleTree', data.merkleTrees)
  mapById('compressedNft', data.compressedNfts)

  for (const item of data.projectVersions) {
    assertReference(projects, item.projectId, 'projectId')
  }
  for (const item of data.categories) {
    assertReference(projectVersions, item.projectVersionId, 'projectVersionId')
  }
  for (const item of data.projectMenus) {
    assertReference(projects, item.projectId, 'projectId')
    if (item.parentId) {
      const parent = projectMenus.get(item.parentId)
      if (!parent) invalidBackup(`unknown projectMenu parentId ${item.parentId}`)
      if (parent.projectId !== item.projectId) {
        invalidBackup(`projectMenu ${item.id} parent belongs to another project`)
      }
    }
  }
  for (const item of data.projectHomes) {
    assertReference(projects, item.projectId, 'projectId')
  }
  for (const item of data.noteInfos) {
    assertReference(categories, item.categoryId, 'categoryId')
  }
  for (const item of data.noteContents) {
    assertReference(noteInfos, item.noteInfoId, 'noteInfoId')
  }
  for (const item of data.compressedNfts) {
    assertReference(merkleTrees, item.merkleTreeId, 'merkleTreeId')
    assertReference(projects, item.projectId, 'projectId')
    if (item.originalImageId) {
      assertReference(fileManagements, item.originalImageId, 'originalImageId')
    }
  }

  const homeProjects = new Set<string>()
  for (const home of projectHomes.values()) {
    if (homeProjects.has(home.projectId)) {
      invalidBackup(`multiple projectHomes for projectId ${home.projectId}`)
    }
    homeProjects.add(home.projectId)
  }

  const menuChildren = new Map<string, string[]>()
  const menuQueue: string[] = []
  for (const menu of projectMenus.values()) {
    if (!menu.parentId) {
      menuQueue.push(menu.id)
      continue
    }
    const children = menuChildren.get(menu.parentId) || []
    children.push(menu.id)
    menuChildren.set(menu.parentId, children)
  }
  let visitedMenus = 0
  for (let index = 0; index < menuQueue.length; index += 1) {
    const id = menuQueue[index]
    visitedMenus += 1
    for (const childId of menuChildren.get(id) || []) {
      menuQueue.push(childId)
    }
  }
  if (visitedMenus !== projectMenus.size) {
    invalidBackup('projectMenu parent cycle detected')
  }

  assertUniqueField('configKey', data.systemConfigs, (item) => item.configKey)
  assertUniqueField('treeAddress', data.merkleTrees, (item) => item.treeAddress)
  assertUniqueField('assetId', data.compressedNfts, (item) => item.assetId)
  assertUniqueField(
    'mintTxSignature',
    data.compressedNfts.filter(
      (item): item is typeof item & { mintTxSignature: string } =>
        item.mintTxSignature !== null,
    ),
    (item) => item.mintTxSignature,
  )
}

export function parseDatabaseImportPayload(input: unknown): DatabaseImportPayload {
  const parsed = databaseImportPayloadSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : ''
    invalidBackup(`${path}${issue?.message || 'invalid structure'}`)
  }

  validateBackupRelations(parsed.data.data)
  return parsed.data
}

export function assertRequestContentLength(request: Request, maxBytes: number) {
  const rawLength = request.headers.get('content-length')
  if (rawLength === null) return
  const contentLength = Number(rawLength)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new HttpError('Request body is too large', 413, 413)
  }
}

function relationClosedMenus<T extends {
  id: bigint
  parentId: bigint | null
  projectId: bigint
}>(menus: T[]) {
  const byId = new Map(menus.map((menu) => [menu.id.toString(), menu]))
  const decisions = new Map<string, boolean>()

  const belongsToActiveRoot = (menu: T, visiting: Set<string>): boolean => {
    const id = menu.id.toString()
    const decided = decisions.get(id)
    if (decided !== undefined) return decided
    if (!menu.parentId) {
      decisions.set(id, true)
      return true
    }
    if (visiting.has(id)) {
      decisions.set(id, false)
      return false
    }

    const parent = byId.get(menu.parentId.toString())
    if (!parent || parent.projectId !== menu.projectId) {
      decisions.set(id, false)
      return false
    }

    const nextVisiting = new Set(visiting)
    nextVisiting.add(id)
    const included = belongsToActiveRoot(parent, nextVisiting)
    decisions.set(id, included)
    return included
  }

  return menus.filter((menu) => belongsToActiveRoot(menu, new Set()))
}

export async function exportDatabaseBackup() {
  const exportedAt = new Date().toISOString()
  const snapshot = await prisma.$transaction(async (tx) => {
    const projects = await tx.project.findMany({ where: { isDeleted: false } })
    const projectIds = projects.map((item) => item.id)

    const [projectVersions, candidateMenus, projectHomes, merkleTrees] =
      await Promise.all([
        tx.projectVersion.findMany({
          where: { isDeleted: false, projectId: { in: projectIds } },
        }),
        tx.projectMenu.findMany({
          where: { isDeleted: false, projectId: { in: projectIds } },
        }),
        tx.projectHome.findMany({
          where: { isDeleted: false, projectId: { in: projectIds } },
        }),
        tx.merkleTree.findMany({ where: { isDeleted: false } }),
      ])

    const projectMenus = relationClosedMenus(candidateMenus)
    const projectVersionIds = projectVersions.map((item) => item.id)
    const categories = await tx.category.findMany({
      where: {
        isDeleted: false,
        projectVersionId: { in: projectVersionIds },
      },
    })
    const categoryIds = categories.map((item) => item.id)
    const noteInfos = await tx.noteInfo.findMany({
      where: { isDeleted: false, categoryId: { in: categoryIds } },
    })
    const noteInfoIds = noteInfos.map((item) => item.id)
    const noteContents = await tx.noteContent.findMany({
      where: { isDeleted: false, noteInfoId: { in: noteInfoIds } },
    })

    const merkleTreeIds = merkleTrees.map((item) => item.id)
    const compressedNfts = await tx.compressedNft.findMany({
      where: {
        merkleTreeId: { in: merkleTreeIds },
        projectId: { in: projectIds },
      },
    })
    const referencedFileIds = [
      ...new Set(
        compressedNfts.flatMap((item) =>
          item.originalImageId ? [item.originalImageId] : [],
        ),
      ),
    ]
    const fileWhere: Prisma.FileManagementWhereInput = {
      OR: [
        { status: 1 },
        ...(referencedFileIds.length > 0
          ? [{ id: { in: referencedFileIds } }]
          : []),
      ],
    }

    const [fileManagements, systemConfigs, systemHomepages] = await Promise.all([
      tx.fileManagement.findMany({ where: fileWhere }),
      tx.systemConfig.findMany(),
      tx.systemHomepage.findMany({ where: { isDeleted: false } }),
    ])
    const exportedFileIds = new Set(fileManagements.map((item) => item.id.toString()))
    const safeCompressedNfts = compressedNfts.map((item) =>
      item.originalImageId && !exportedFileIds.has(item.originalImageId.toString())
        ? { ...item, originalImageId: null }
        : item,
    )

    return {
      projects,
      projectVersions,
      categories,
      projectMenus,
      projectHomes,
      noteInfos,
      noteContents,
      fileManagements,
      systemConfigs,
      systemHomepages,
      merkleTrees,
      compressedNfts: safeCompressedNfts,
    }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: DATABASE_TRANSACTION_MAX_WAIT_MS,
    timeout: DATABASE_TRANSACTION_TIMEOUT_MS,
  })

  const data = backupDataSchema.parse(toJsonSafe(snapshot))
  validateBackupRelations(data)

  return {
    version: '2.0.0',
    exportedAt,
    data,
  }
}

async function deleteBusinessData(tx: Prisma.TransactionClient) {
  const compressedNfts = await tx.compressedNft.deleteMany({})
  const merkleTrees = await tx.merkleTree.deleteMany({})
  const noteContents = await tx.noteContent.deleteMany({})
  const noteInfos = await tx.noteInfo.deleteMany({})
  const categories = await tx.category.deleteMany({})
  const projectVersions = await tx.projectVersion.deleteMany({})
  const projectMenus = await tx.projectMenu.deleteMany({})
  const projectHomes = await tx.projectHome.deleteMany({})
  const projects = await tx.project.deleteMany({})
  const fileManagements = await tx.fileManagement.deleteMany({})
  const systemConfigs = await tx.systemConfig.deleteMany({})
  const systemHomepages = await tx.systemHomepage.deleteMany({})

  const deleted = {
    compressedNfts: compressedNfts.count,
    merkleTrees: merkleTrees.count,
    noteContents: noteContents.count,
    noteInfos: noteInfos.count,
    categories: categories.count,
    projectVersions: projectVersions.count,
    projectMenus: projectMenus.count,
    projectHomes: projectHomes.count,
    projects: projects.count,
    fileManagements: fileManagements.count,
    systemConfigs: systemConfigs.count,
    systemHomepages: systemHomepages.count,
  }
  return {
    deleted,
    totalDeleted: Object.values(deleted).reduce((total, count) => total + count, 0),
  }
}

function orderedMenus(data: BackupData) {
  const children = new Map<string, BackupData['projectMenus']>()
  const result: BackupData['projectMenus'] = []
  for (const item of data.projectMenus) {
    if (!item.parentId) {
      result.push(item)
      continue
    }
    const siblings = children.get(item.parentId) || []
    siblings.push(item)
    children.set(item.parentId, siblings)
  }
  for (let index = 0; index < result.length; index += 1) {
    for (const child of children.get(result[index].id) || []) {
      result.push(child)
    }
  }
  return result
}

function selectedPrimaryContentIds(data: BackupData) {
  const byNote = new Map<string, BackupData['noteContents']>()
  for (const item of data.noteContents) {
    if (item.isDeleted) continue
    const contents = byNote.get(item.noteInfoId) || []
    contents.push(item)
    byNote.set(item.noteInfoId, contents)
  }

  const selected = new Map<string, string>()
  for (const [noteInfoId, contents] of byNote) {
    contents.sort((left, right) => {
      const updatedDifference =
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      if (updatedDifference !== 0) return updatedDifference
      const createdDifference =
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      if (createdDifference !== 0) return createdDifference
      const leftId = BigInt(left.id)
      const rightId = BigInt(right.id)
      return leftId === rightId ? 0 : leftId < rightId ? 1 : -1
    })
    selected.set(
      noteInfoId,
      contents.find((item) => item.isPrimary)?.id || contents[0].id,
    )
  }
  return selected
}

function requiredMappedId(map: Map<string, bigint>, id: string, label: string) {
  const mapped = map.get(id)
  if (!mapped) throw new Error(`Validated ${label} mapping is missing`)
  return mapped
}

export async function importDatabaseBackup(payload: DatabaseImportPayload) {
  const { data, mode } = payload
  const primaryContentIds = selectedPrimaryContentIds(data)

  return prisma.$transaction(async (tx) => {
    if (mode === 'overwrite') await deleteBusinessData(tx)

    const ids = {
      projects: new Map<string, bigint>(),
      projectVersions: new Map<string, bigint>(),
      categories: new Map<string, bigint>(),
      projectMenus: new Map<string, bigint>(),
      projectHomes: new Map<string, bigint>(),
      noteInfos: new Map<string, bigint>(),
      noteContents: new Map<string, bigint>(),
      fileManagements: new Map<string, bigint>(),
      systemConfigs: new Map<string, bigint>(),
      systemHomepages: new Map<string, bigint>(),
      merkleTrees: new Map<string, bigint>(),
      compressedNfts: new Map<string, bigint>(),
    }

    for (const item of data.projects) {
      const created = await tx.project.create({
        data: {
          projectName: item.projectName,
          avatar: item.avatar,
          weight: item.weight,
          status: item.status,
          requireAuth: item.requireAuth,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
          isDeleted: item.isDeleted,
        },
      })
      ids.projects.set(item.id, created.id)
    }

    for (const item of data.projectVersions) {
      const created = await tx.projectVersion.create({
        data: {
          projectId: requiredMappedId(ids.projects, item.projectId, 'projectId'),
          version: item.version,
          description: item.description,
          weight: item.weight,
          status: item.status,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
          isDeleted: item.isDeleted,
        },
      })
      ids.projectVersions.set(item.id, created.id)
    }

    for (const item of data.categories) {
      const created = await tx.category.create({
        data: {
          projectVersionId: requiredMappedId(
            ids.projectVersions,
            item.projectVersionId,
            'projectVersionId',
          ),
          categoryName: item.categoryName,
          weight: item.weight,
          status: item.status,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
          isDeleted: item.isDeleted,
        },
      })
      ids.categories.set(item.id, created.id)
    }

    for (const item of orderedMenus(data)) {
      const created = await tx.projectMenu.create({
        data: {
          projectId: requiredMappedId(ids.projects, item.projectId, 'projectId'),
          parentId: item.parentId
            ? requiredMappedId(ids.projectMenus, item.parentId, 'parentId')
            : null,
          label: item.label,
          url: item.url,
          isExternal: item.isExternal,
          weight: item.weight,
          status: item.status,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
          isDeleted: item.isDeleted,
        },
      })
      ids.projectMenus.set(item.id, created.id)
    }

    for (const item of data.projectHomes) {
      const created = await tx.projectHome.create({
        data: {
          projectId: requiredMappedId(ids.projects, item.projectId, 'projectId'),
          content: item.content,
          status: item.status,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
          isDeleted: item.isDeleted,
        },
      })
      ids.projectHomes.set(item.id, created.id)
    }

    for (const item of data.noteInfos) {
      const created = await tx.noteInfo.create({
        data: {
          categoryId: requiredMappedId(ids.categories, item.categoryId, 'categoryId'),
          noteTitle: item.noteTitle,
          weight: item.weight,
          status: item.status,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
          isDeleted: item.isDeleted,
        },
      })
      ids.noteInfos.set(item.id, created.id)
    }

    for (const item of data.noteContents) {
      const created = await tx.noteContent.create({
        data: {
          noteInfoId: requiredMappedId(ids.noteInfos, item.noteInfoId, 'noteInfoId'),
          content: item.content,
          versionNote: item.versionNote,
          isPrimary: false,
          status: item.status,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
          isDeleted: item.isDeleted,
        },
      })
      ids.noteContents.set(item.id, created.id)
    }

    for (const oldContentId of primaryContentIds.values()) {
      await tx.noteContent.update({
        where: {
          id: requiredMappedId(ids.noteContents, oldContentId, 'noteContentId'),
        },
        data: { isPrimary: true },
      })
    }

    for (const item of data.fileManagements) {
      const created = await tx.fileManagement.create({
        data: {
          originalName: item.originalName,
          fileName: item.fileName,
          filePath: item.filePath,
          fileSize: BigInt(item.fileSize),
          businessType: item.businessType,
          status: item.status,
          createTime: new Date(item.createTime),
        },
      })
      ids.fileManagements.set(item.id, created.id)
    }

    for (const item of data.systemConfigs) {
      const record = await tx.systemConfig.upsert({
        where: { configKey: item.configKey },
        update: {
          configValue: item.configValue,
          description: item.description,
          updatedAt: new Date(item.updatedAt),
        },
        create: {
          configKey: item.configKey,
          configValue: item.configValue,
          description: item.description,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        },
      })
      ids.systemConfigs.set(item.id, record.id)
    }

    for (const item of data.systemHomepages) {
      const created = await tx.systemHomepage.create({
        data: {
          content: item.content,
          status: item.status,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
          isDeleted: item.isDeleted,
        },
      })
      ids.systemHomepages.set(item.id, created.id)
    }

    for (const item of data.merkleTrees) {
      const record = await tx.merkleTree.upsert({
        where: { treeAddress: item.treeAddress },
        update: {},
        create: {
          name: item.name,
          treeAddress: item.treeAddress,
          treeAuthority: item.treeAuthority,
          encryptedKey: item.encryptedKey,
          creatorAddress: item.creatorAddress,
          maxDepth: item.maxDepth,
          maxBufferSize: item.maxBufferSize,
          canopyDepth: item.canopyDepth,
          network: item.network,
          totalMinted: item.totalMinted,
          maxCapacity: BigInt(item.maxCapacity),
          creationCost: BigInt(item.creationCost),
          txSignature: item.txSignature,
          priority: item.priority,
          status: item.status,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
          isDeleted: item.isDeleted,
        },
      })
      ids.merkleTrees.set(item.id, record.id)
    }

    for (const item of data.compressedNfts) {
      const record = await tx.compressedNft.upsert({
        where: { assetId: item.assetId },
        update: {},
        create: {
          merkleTreeId: requiredMappedId(
            ids.merkleTrees,
            item.merkleTreeId,
            'merkleTreeId',
          ),
          projectId: requiredMappedId(ids.projects, item.projectId, 'projectId'),
          assetId: item.assetId,
          leafIndex: item.leafIndex,
          name: item.name,
          symbol: item.symbol,
          description: item.description,
          metadataUri: item.metadataUri,
          imageCid: item.imageCid,
          metadataCid: item.metadataCid,
          originalImageId: item.originalImageId
            ? requiredMappedId(
                ids.fileManagements,
                item.originalImageId,
                'originalImageId',
              )
            : null,
          ownerAddress: item.ownerAddress,
          mintTxSignature: item.mintTxSignature,
          prepareExpiresAt: item.prepareExpiresAt
            ? new Date(item.prepareExpiresAt)
            : null,
          lastValidBlockHeight: item.lastValidBlockHeight
            ? BigInt(item.lastValidBlockHeight)
            : null,
          status: item.status,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        },
      })
      ids.compressedNfts.set(item.id, record.id)
    }

    return {
      message: 'Database import completed successfully',
      mode,
      imported: {
        projects: ids.projects.size,
        projectVersions: ids.projectVersions.size,
        categories: ids.categories.size,
        projectMenus: ids.projectMenus.size,
        projectHomes: ids.projectHomes.size,
        noteInfos: ids.noteInfos.size,
        noteContents: ids.noteContents.size,
        fileManagements: ids.fileManagements.size,
        systemConfigs: ids.systemConfigs.size,
        systemHomepages: ids.systemHomepages.size,
        merkleTrees: ids.merkleTrees.size,
        compressedNfts: ids.compressedNfts.size,
      },
    }
  }, {
    maxWait: DATABASE_TRANSACTION_MAX_WAIT_MS,
    timeout: DATABASE_TRANSACTION_TIMEOUT_MS,
  })
}

type StorageTreeEntry = {
  absolutePath: string
  relativePath: string
  kind: 'directory' | 'file'
}

type ValidatedZipEntry = {
  entry: ZipEntry
  segments: string[]
  relativePath: string
  kind: 'directory' | 'file'
  declaredSize: number
}

function assertContained(root: string, candidate: string) {
  const relativePath = relative(root, candidate)
  const isWithinRoot =
    relativePath === '' ||
    (!isAbsolute(relativePath) &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`))
  if (!isWithinRoot) throw new HttpError('Access denied', 403, 403)
  return candidate
}

function resolveWithin(root: string, ...segments: string[]) {
  return assertContained(root, resolve(root, ...segments))
}

function relativePathSegments(relativePath: string) {
  return relativePath.split('/').filter(Boolean)
}

function toArchivePath(root: string, absolutePath: string) {
  const relativePath = relative(root, assertContained(root, absolutePath))
  return relativePath.split(sep).join('/')
}

async function ensureUploadRoot() {
  await mkdir(UPLOAD_ROOT, { recursive: true })
  return realpath(UPLOAD_ROOT)
}

async function removePathBestEffort(path: string, label: string) {
  try {
    await rm(assertContained(UPLOAD_ROOT, path), { recursive: true, force: true })
  } catch (error) {
    console.error(`[backup] Failed to clean ${label}`, error)
  }
}

async function collectExportEntries(
  currentDirectory: string,
  result: StorageTreeEntry[],
) {
  const entries = await readdir(currentDirectory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.name.includes('\0') || entry.name.includes('\\')) {
      throw new Error('Uploads contain an unsupported file name')
    }

    const absolutePath = assertContained(
      UPLOAD_ROOT,
      resolve(currentDirectory, entry.name),
    )
    const stats = await lstat(absolutePath)
    if (stats.isSymbolicLink()) continue

    const relativePath = toArchivePath(UPLOAD_ROOT, absolutePath)
    if (Buffer.byteLength(relativePath, 'utf8') > ZIP_PATH_MAX_BYTES) {
      throw new Error('Uploads contain a path that is too long to back up')
    }

    if (stats.isDirectory()) {
      result.push({ absolutePath, relativePath, kind: 'directory' })
      await collectExportEntries(absolutePath, result)
    } else if (stats.isFile()) {
      result.push({ absolutePath, relativePath, kind: 'file' })
    }
  }
}

export async function createFilesExportArchive() {
  const entries: StorageTreeEntry[] = []
  try {
    await collectExportEntries(UPLOAD_ROOT, entries)
  } catch (error) {
    if (!nodeErrorHasCode(error, 'ENOENT')) throw error
  }

  const archive = archiver('zip', { zlib: { level: 9 } })
  archive.on('warning', (error) => archive.destroy(error))

  for (const entry of entries) {
    if (entry.kind === 'directory') {
      archive.append('', { name: `${entry.relativePath}/` })
    } else {
      archive.file(entry.absolutePath, { name: entry.relativePath })
    }
  }
  return archive
}

function isZipSignature(buffer: Buffer) {
  if (buffer.length < 4) return false
  const signature = buffer.readUInt32LE(0)
  return signature === 0x04034b50 || signature === 0x06054b50
}

function preflightZipCentralDirectory(buffer: Buffer) {
  const minimumOffset = Math.max(0, buffer.length - (65_535 + 22))
  let endOffset = -1
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (
      buffer.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length
    ) {
      endOffset = offset
      break
    }
  }
  if (endOffset < 0) throw new HttpError('Invalid ZIP archive', 400, 400)

  const diskNumber = buffer.readUInt16LE(endOffset + 4)
  const diskStart = buffer.readUInt16LE(endOffset + 6)
  const recordsOnDisk = buffer.readUInt16LE(endOffset + 8)
  const numberOfRecords = buffer.readUInt16LE(endOffset + 10)
  const centralSize = buffer.readUInt32LE(endOffset + 12)
  const centralOffset = buffer.readUInt32LE(endOffset + 16)
  const commentLength = buffer.readUInt16LE(endOffset + 20)

  if (endOffset + 22 + commentLength !== buffer.length) {
    throw new HttpError('Invalid ZIP end record', 400, 400)
  }
  if (
    diskNumber !== 0 ||
    diskStart !== 0 ||
    recordsOnDisk !== numberOfRecords
  ) {
    throw new HttpError('Multi-disk ZIP archives are not supported', 400, 400)
  }
  if (
    numberOfRecords === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new HttpError('ZIP64 archives are not supported', 400, 400)
  }
  if (numberOfRecords > ZIP_ENTRY_LIMIT) {
    throw new HttpError(`ZIP entry count exceeds ${ZIP_ENTRY_LIMIT}`, 400, 400)
  }
  if (centralOffset + centralSize > endOffset) {
    throw new HttpError('Invalid ZIP central directory bounds', 400, 400)
  }

  return { numberOfRecords, centralSize, centralOffset }
}

function zipEntryKind(entry: ZipEntry): 'directory' | 'file' {
  if (entry.type === 'Directory') return 'directory'
  if (entry.type === 'File') return 'file'
  throw new HttpError('ZIP contains an unsupported entry type', 400, 400)
}

function validateZipEntryPath(entry: ZipEntry, kind: 'directory' | 'file') {
  const rawPath = entry.path
  if (
    !rawPath ||
    rawPath.includes('\0') ||
    rawPath.includes('\\') ||
    rawPath.includes('\uFFFD') ||
    rawPath.startsWith('/') ||
    isAbsolute(rawPath) ||
    win32.isAbsolute(rawPath) ||
    /^[A-Za-z]:/.test(rawPath) ||
    Buffer.byteLength(rawPath, 'utf8') > ZIP_PATH_MAX_BYTES
  ) {
    throw new HttpError('ZIP contains an unsafe path', 400, 400)
  }

  const segments = rawPath.split('/')
  if (kind === 'directory' && segments.at(-1) === '') segments.pop()
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        !segment || segment === '.' || segment === '..' || segment.startsWith('.'),
    )
  ) {
    throw new HttpError('ZIP contains an unsafe path', 400, 400)
  }
  if (kind === 'file' && rawPath.endsWith('/')) {
    throw new HttpError('ZIP file entry has a directory path', 400, 400)
  }
  return segments
}

function assertRegularZipEntry(entry: ZipEntry, kind: 'directory' | 'file') {
  if ((entry.flags & 0x01) !== 0) {
    throw new HttpError('Encrypted ZIP entries are not supported', 400, 400)
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new HttpError('ZIP uses an unsupported compression method', 400, 400)
  }

  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  const unixFileType = unixMode & 0o170000
  const regularFile = 0o100000
  const directory = 0o040000
  if (
    unixFileType !== 0 &&
    unixFileType !== regularFile &&
    unixFileType !== directory
  ) {
    throw new HttpError('ZIP contains a symlink or special entry', 400, 400)
  }
  if (
    (kind === 'file' && unixFileType === directory) ||
    (kind === 'directory' && unixFileType === regularFile)
  ) {
    throw new HttpError('ZIP entry type metadata is inconsistent', 400, 400)
  }
}

async function validateZipArchive(buffer: Buffer) {
  if (!isZipSignature(buffer)) {
    throw new HttpError('Invalid ZIP archive', 400, 400)
  }
  const preflight = preflightZipCentralDirectory(buffer)

  let directory: Awaited<ReturnType<typeof unzipper.Open.buffer>>
  try {
    directory = await unzipper.Open.buffer(buffer)
  } catch {
    throw new HttpError('Invalid ZIP archive', 400, 400)
  }

  if (
    directory.diskNumber !== 0 ||
    directory.diskStart !== 0 ||
    directory.numberOfRecordsOnDisk !== directory.numberOfRecords ||
    directory.files.length !== directory.numberOfRecords ||
    directory.numberOfRecords !== preflight.numberOfRecords ||
    directory.sizeOfCentralDirectory !== preflight.centralSize ||
    directory.offsetToStartOfCentralDirectory !== preflight.centralOffset
  ) {
    throw new HttpError('Multi-disk or inconsistent ZIP archives are not supported', 400, 400)
  }
  if (directory.files.length > ZIP_ENTRY_LIMIT) {
    throw new HttpError(`ZIP entry count exceeds ${ZIP_ENTRY_LIMIT}`, 400, 400)
  }

  const entries: ValidatedZipEntry[] = []
  const normalizedPaths = new Map<string, 'directory' | 'file'>()
  let declaredTotal = 0

  for (const entry of directory.files) {
    const kind = zipEntryKind(entry)
    assertRegularZipEntry(entry, kind)
    const segments = validateZipEntryPath(entry, kind)
    const relativePath = segments.join('/')
    const normalizedKey = relativePath.toLocaleLowerCase('en-US')
    if (normalizedPaths.has(normalizedKey)) {
      throw new HttpError('ZIP contains duplicate paths', 400, 400)
    }

    if (
      !Number.isSafeInteger(entry.uncompressedSize) ||
      entry.uncompressedSize < 0 ||
      !Number.isSafeInteger(entry.compressedSize) ||
      entry.compressedSize < 0 ||
      entry.compressedSize > ZIP_FILE_MAX_BYTES
    ) {
      throw new HttpError('ZIP contains an invalid entry size', 400, 400)
    }
    if (kind === 'directory' && entry.uncompressedSize !== 0) {
      throw new HttpError('ZIP directory entry has content', 400, 400)
    }
    if (entry.uncompressedSize > ZIP_ENTRY_MAX_BYTES) {
      throw new HttpError('ZIP entry exceeds the size limit', 400, 400)
    }

    declaredTotal += entry.uncompressedSize
    if (declaredTotal > ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES) {
      throw new HttpError('ZIP exceeds the total uncompressed size limit', 400, 400)
    }

    normalizedPaths.set(normalizedKey, kind)
    entries.push({
      entry,
      segments,
      relativePath,
      kind,
      declaredSize: entry.uncompressedSize,
    })
  }

  for (const item of entries) {
    for (let index = 1; index < item.segments.length; index += 1) {
      const parentKey = item.segments
        .slice(0, index)
        .join('/')
        .toLocaleLowerCase('en-US')
      if (normalizedPaths.get(parentKey) === 'file') {
        throw new HttpError('ZIP contains a file/directory path conflict', 400, 400)
      }
    }
  }
  return entries
}

const CRC32_TABLE = Array.from({ length: 256 }, (_value, index) => {
  let current = index
  for (let bit = 0; bit < 8; bit += 1) {
    current = (current & 1) !== 0 ? 0xedb88320 ^ (current >>> 1) : current >>> 1
  }
  return current >>> 0
})

function updateCrc32(current: number, chunk: Buffer) {
  let crc = current
  for (const byte of chunk) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return crc >>> 0
}

function isFileSystemFailure(error: unknown) {
  return [
    'EACCES',
    'EDQUOT',
    'EIO',
    'EMFILE',
    'ENFILE',
    'ENOSPC',
    'EROFS',
  ].some((code) => nodeErrorHasCode(error, code))
}

async function createStagingDirectory(prefix: string) {
  const realUploadRoot = await ensureUploadRoot()
  const stagingDirectory = resolveWithin(UPLOAD_ROOT, `${prefix}${randomUUID()}`)
  await mkdir(stagingDirectory)
  const realStagingDirectory = await realpath(stagingDirectory)
  assertContained(realUploadRoot, realStagingDirectory)
  return stagingDirectory
}

async function extractZipToStaging(entries: ValidatedZipEntry[], stagingDirectory: string) {
  let actualTotal = 0
  let filesImported = 0

  for (const item of entries) {
    const targetPath = resolveWithin(stagingDirectory, ...item.segments)
    if (item.kind === 'directory') {
      await mkdir(targetPath, { recursive: true })
      continue
    }

    await mkdir(dirname(targetPath), { recursive: true })
    let entryBytes = 0
    let crc = 0xffffffff
    const limiter = new Transform({
      transform(chunk: Buffer | string, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        entryBytes += buffer.length
        actualTotal += buffer.length
        if (entryBytes > ZIP_ENTRY_MAX_BYTES) {
          callback(new HttpError('ZIP entry exceeds the size limit', 400, 400))
          return
        }
        if (actualTotal > ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES) {
          callback(new HttpError('ZIP exceeds the total uncompressed size limit', 400, 400))
          return
        }
        crc = updateCrc32(crc, buffer)
        callback(null, buffer)
      },
    })

    try {
      await pipeline(
        item.entry.stream(),
        limiter,
        createWriteStream(targetPath, { flags: 'wx', mode: 0o600 }),
      )
    } catch (error) {
      if (error instanceof HttpError || isFileSystemFailure(error)) throw error
      throw new HttpError('Invalid or corrupted ZIP archive', 400, 400)
    }

    const checksum = (crc ^ 0xffffffff) >>> 0
    if (entryBytes !== item.declaredSize || checksum !== (item.entry.crc32 >>> 0)) {
      throw new HttpError('ZIP entry size or checksum mismatch', 400, 400)
    }
    filesImported += 1
  }
  return filesImported
}

async function collectStorageTree(
  root: string,
  currentDirectory = root,
  result: StorageTreeEntry[] = [],
) {
  const entries = await readdir(currentDirectory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    const absolutePath = resolveWithin(root, ...relative(root, resolve(currentDirectory, entry.name)).split(sep))
    const stats = await lstat(absolutePath)
    if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
      throw new Error('Staging contains a non-regular entry')
    }
    const relativePath = toArchivePath(root, absolutePath)
    const kind = stats.isDirectory() ? 'directory' : 'file'
    result.push({ absolutePath, relativePath, kind })
    if (kind === 'directory') await collectStorageTree(root, absolutePath, result)
  }
  return result
}

async function lstatOrNull(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if (nodeErrorHasCode(error, 'ENOENT')) return null
    throw error
  }
}

async function rollbackInsertedFiles(
  linkedFiles: Array<{ source: string; destination: string }>,
  createdDirectories: string[],
) {
  for (const item of linkedFiles.toReversed()) {
    try {
      if (!(await lstatOrNull(item.source)) && (await lstatOrNull(item.destination))) {
        await link(item.destination, item.source)
      }
      await unlink(item.destination).catch((error) => {
        if (!nodeErrorHasCode(error, 'ENOENT')) throw error
      })
    } catch (error) {
      console.error('[backup] Failed to roll back inserted file', error)
    }
  }
  for (const directory of createdDirectories.toReversed()) {
    try {
      await rmdir(directory)
    } catch (error) {
      if (!nodeErrorHasCode(error, 'ENOENT') && !nodeErrorHasCode(error, 'ENOTEMPTY')) {
        console.error('[backup] Failed to remove inserted directory during rollback', error)
      }
    }
  }
}

async function commitInsert(stagingDirectory: string) {
  const entries = await collectStorageTree(stagingDirectory)
  const directories = entries
    .filter((entry) => entry.kind === 'directory')
    .sort(
      (left, right) =>
        relativePathSegments(left.relativePath).length -
        relativePathSegments(right.relativePath).length,
    )
  const files = entries.filter((entry) => entry.kind === 'file')

  for (const entry of directories) {
    const destination = resolveWithin(
      UPLOAD_ROOT,
      ...relativePathSegments(entry.relativePath),
    )
    const existing = await lstatOrNull(destination)
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
      throw new HttpError(`File conflict: ${entry.relativePath}`, 409, 409)
    }
  }
  for (const entry of files) {
    const destination = resolveWithin(
      UPLOAD_ROOT,
      ...relativePathSegments(entry.relativePath),
    )
    if (await lstatOrNull(destination)) {
      throw new HttpError(`File conflict: ${entry.relativePath}`, 409, 409)
    }
  }

  const createdDirectories: string[] = []
  const linkedFiles: Array<{ source: string; destination: string }> = []
  try {
    for (const entry of directories) {
      const destination = resolveWithin(
        UPLOAD_ROOT,
        ...relativePathSegments(entry.relativePath),
      )
      if (!(await lstatOrNull(destination))) {
        await mkdir(destination)
        createdDirectories.push(destination)
      }
    }

    for (const entry of files) {
      const destination = resolveWithin(
        UPLOAD_ROOT,
        ...relativePathSegments(entry.relativePath),
      )
      await link(entry.absolutePath, destination)
      linkedFiles.push({ source: entry.absolutePath, destination })
      await unlink(entry.absolutePath)
    }
  } catch (error) {
    await rollbackInsertedFiles(linkedFiles, createdDirectories)
    throw error
  }

  await removePathBestEffort(stagingDirectory, 'files-import staging directory')
}

async function restoreRootEntries(
  sourceDirectory: string,
  names: string[],
) {
  let firstError: unknown = null
  for (const name of names.toReversed()) {
    try {
      const source = resolveWithin(sourceDirectory, name)
      const destination = resolveWithin(UPLOAD_ROOT, name)
      if (!(await lstatOrNull(source))) continue
      if (await lstatOrNull(destination)) {
        throw new Error(`Cannot restore ${name}: destination already exists`)
      }
      await rename(source, destination)
    } catch (error) {
      firstError ??= error
      console.error(`[backup] Failed to restore root entry ${name}`, error)
    }
  }
  if (firstError) throw firstError
}

async function visibleRootNames() {
  const entries = await readdir(UPLOAD_ROOT, { withFileTypes: true })
  return entries
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
}

async function commitOverwrite(stagingDirectory: string) {
  await ensureUploadRoot()
  const rollbackDirectory = resolveWithin(
    UPLOAD_ROOT,
    `.backup-rollback-${randomUUID()}`,
  )
  await mkdir(rollbackDirectory)
  let previousNames: string[]
  let stagedNames: string[]
  try {
    previousNames = await visibleRootNames()
    stagedNames = (await readdir(stagingDirectory, { withFileTypes: true }))
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    await removePathBestEffort(rollbackDirectory, 'unused files-import rollback directory')
    throw error
  }
  const movedPrevious: string[] = []
  const committed: string[] = []

  try {
    for (const name of previousNames) {
      await rename(
        resolveWithin(UPLOAD_ROOT, name),
        resolveWithin(rollbackDirectory, name),
      )
      movedPrevious.push(name)
    }

    for (const name of stagedNames) {
      const destination = resolveWithin(UPLOAD_ROOT, name)
      if (await lstatOrNull(destination)) {
        throw new Error(`Cannot commit ${name}: destination already exists`)
      }
      await rename(
        resolveWithin(stagingDirectory, name),
        destination,
      )
      committed.push(name)
    }
  } catch (error) {
    for (const name of committed.toReversed()) {
      try {
        await rename(
          resolveWithin(UPLOAD_ROOT, name),
          resolveWithin(stagingDirectory, name),
        )
      } catch (restoreError) {
        console.error('[backup] Failed to move committed import back to staging', restoreError)
      }
    }
    let restored = false
    try {
      await restoreRootEntries(rollbackDirectory, movedPrevious)
      restored = true
    } catch (restoreError) {
      console.error('[backup] Failed to restore files-import rollback', restoreError)
    }
    if (restored) {
      await removePathBestEffort(
        rollbackDirectory,
        'restored files-import rollback directory',
      )
    }
    throw error
  }

  await removePathBestEffort(rollbackDirectory, 'files-import rollback directory')
  await removePathBestEffort(stagingDirectory, 'files-import staging directory')
}

export async function importFilesBackup(zipBuffer: Buffer, mode: ImportMode) {
  if (zipBuffer.length > ZIP_FILE_MAX_BYTES) {
    throw new HttpError('ZIP file exceeds the 250MB limit', 413, 413)
  }

  const entries = await validateZipArchive(zipBuffer)
  const stagingDirectory = await createStagingDirectory('.backup-staging-')
  let filesImported: number
  try {
    filesImported = await extractZipToStaging(entries, stagingDirectory)
    if (mode === 'overwrite') await commitOverwrite(stagingDirectory)
    else await commitInsert(stagingDirectory)
  } catch (error) {
    await removePathBestEffort(stagingDirectory, 'failed files-import staging directory')
    throw error
  }

  return {
    message: 'Files import completed successfully',
    mode,
    filesImported,
  }
}

async function countVisiblePath(path: string): Promise<number> {
  const stats = await lstat(path)
  if (!stats.isDirectory() || stats.isSymbolicLink()) return 1
  const entries = await readdir(path, { withFileTypes: true })
  let count = 0
  for (const entry of entries) {
    count += await countVisiblePath(resolveWithin(UPLOAD_ROOT, ...relative(UPLOAD_ROOT, resolve(path, entry.name)).split(sep)))
  }
  return count
}

async function stageVisibleUploads(prefix: string) {
  await ensureUploadRoot()
  const rollbackDirectory = resolveWithin(UPLOAD_ROOT, `${prefix}${randomUUID()}`)
  await mkdir(rollbackDirectory)
  let names: string[] = []
  let filesDeleted = 0
  let dirsDeleted = 0
  const moved: string[] = []
  try {
    names = await visibleRootNames()
    for (const name of names) {
      const source = resolveWithin(UPLOAD_ROOT, name)
      const stats = await lstat(source)
      filesDeleted += await countVisiblePath(source)
      if (stats.isDirectory() && !stats.isSymbolicLink()) dirsDeleted += 1
    }

    for (const name of names) {
      await rename(
        resolveWithin(UPLOAD_ROOT, name),
        resolveWithin(rollbackDirectory, name),
      )
      moved.push(name)
    }
  } catch (error) {
    let restored = false
    try {
      await restoreRootEntries(rollbackDirectory, moved)
      restored = true
    } catch (restoreError) {
      console.error('[backup] Failed to restore reset staging', restoreError)
    }
    if (restored) {
      await removePathBestEffort(rollbackDirectory, 'failed reset staging directory')
    }
    throw error
  }

  return { rollbackDirectory, names: moved, filesDeleted, dirsDeleted }
}

async function createResetDirectories() {
  const created: string[] = []
  try {
    for (const name of STANDARD_RESET_DIRECTORIES) {
      const directory = resolveWithin(UPLOAD_ROOT, name)
      await mkdir(directory)
      created.push(directory)
    }
    return created
  } catch (error) {
    await removeResetDirectories(created)
    throw error
  }
}

async function removeResetDirectories(directories: string[]) {
  for (const directory of directories.toReversed()) {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function resetSystem(options: {
  clearDatabase: boolean
  clearFiles: boolean
}) {
  let stagedFiles:
    | Awaited<ReturnType<typeof stageVisibleUploads>>
    | null = null
  let resetDirectories: string[] = []

  if (options.clearFiles) {
    stagedFiles = await stageVisibleUploads('.reset-rollback-')
    try {
      resetDirectories = await createResetDirectories()
    } catch (error) {
      await removeResetDirectories(resetDirectories)
      await restoreRootEntries(stagedFiles.rollbackDirectory, stagedFiles.names)
      await removePathBestEffort(
        stagedFiles.rollbackDirectory,
        'failed system-reset rollback directory',
      )
      throw error
    }
  }

  let databaseResult: Awaited<ReturnType<typeof deleteBusinessData>> | null = null
  try {
    if (options.clearDatabase) {
      databaseResult = await prisma.$transaction(
        (tx) => deleteBusinessData(tx),
        {
          maxWait: DATABASE_TRANSACTION_MAX_WAIT_MS,
          timeout: DATABASE_TRANSACTION_TIMEOUT_MS,
        },
      )
    }
  } catch (error) {
    if (stagedFiles) {
      try {
        await removeResetDirectories(resetDirectories)
      } catch (cleanupError) {
        console.error('[backup] Failed to remove reset directories before restore', cleanupError)
      }
      let restored = false
      try {
        await restoreRootEntries(stagedFiles.rollbackDirectory, stagedFiles.names)
        restored = true
      } catch (restoreError) {
        console.error(
          '[backup] Failed to restore files after database reset failure',
          restoreError,
        )
      }
      if (restored) {
        await removePathBestEffort(
          stagedFiles.rollbackDirectory,
          'restored system-reset rollback directory',
        )
      }
    }
    throw error
  }

  if (stagedFiles) {
    void removePathBestEffort(stagedFiles.rollbackDirectory, 'system-reset rollback directory')
  }

  return {
    message: 'System reset completed successfully',
    database: databaseResult
      ? { success: true as const, ...databaseResult }
      : null,
    files: stagedFiles
      ? {
          success: true as const,
          filesDeleted: stagedFiles.filesDeleted,
          dirsDeleted: stagedFiles.dirsDeleted,
          standardDirsRecreated: [...STANDARD_RESET_DIRECTORIES],
        }
      : null,
  }
}
