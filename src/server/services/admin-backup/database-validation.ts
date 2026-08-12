/**
 * @file database-validation.ts
 * @project SlothVault
 * @module Admin Database Backup Validation
 * @description Validates cross-record backup relations, immutable release metadata, and database import payloads before mutation.
 * @logic Reject duplicate identities, broken references, menu cycles, partial release identity groups, unsafe tree capacity, and oversized requests while converting legacy 2.0 versions to drafts.
 * @dependencies server/http/errors, backup constants, database backup schema
 * @index_tags admin,backup,database,validation,relations,request-limits
 * @author holic512
 */
import 'server-only'

import { HttpError } from '@/server/http/errors'

import {
  BACKUP_COLLECTION_KEYS,
  DATABASE_RECORD_LIMIT,
} from './constants'
import {
  databaseImportPayloadSchema,
  type BackupData,
  type DatabaseImportPayload,
} from './database-schema'

function invalidBackup(message: string): never {
  throw new HttpError(`Invalid backup data: ${message}`, 400, 400)
}

export function hasDatabaseErrorCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
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

export function validateBackupRelations(data: BackupData) {
  const totalRecords = BACKUP_COLLECTION_KEYS.reduce(
    (total, key) => total + data[key].length,
    0,
  )
  if (totalRecords > DATABASE_RECORD_LIMIT) {
    invalidBackup(`record count exceeds ${DATABASE_RECORD_LIMIT}`)
  }

  const users = mapById('user', data.users)
  const pointTransactions = mapById('pointTransaction', data.pointTransactions)
  const giftCardBatches = mapById('giftCardBatch', data.giftCardBatches)
  const giftCards = mapById('giftCard', data.giftCards)
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

  if (data.users.length > 0 && !data.users.some((user) => user.role === 'ADMIN')) {
    invalidBackup('user collection does not contain an administrator')
  }
  for (const item of pointTransactions.values()) {
    assertReference(users, item.userId, 'pointTransaction userId')
  }
  for (const item of giftCardBatches.values()) {
    assertReference(users, item.createdById, 'giftCardBatch createdById')
  }
  for (const item of giftCards.values()) {
    assertReference(giftCardBatches, item.batchId, 'giftCard batchId')
    if (item.redeemedById) assertReference(users, item.redeemedById, 'giftCard redeemedById')
  }

  for (const item of data.projectVersions) {
    assertReference(projects, item.projectId, 'projectId')
    const releaseFields = [
      item.releaseId,
      item.releaseHash,
      item.manifestVersion,
      item.publishedAt,
    ]
    const present = releaseFields.filter((value) => value !== null).length
    if (present !== 0 && present !== releaseFields.length) {
      invalidBackup(`projectVersion ${item.id} has partial release metadata`)
    }
    if (present === 0 && item.status !== 0) {
      invalidBackup(`draft projectVersion ${item.id} must have status 0`)
    }
    if (present === releaseFields.length && item.status !== 0 && item.status !== 1) {
      invalidBackup(`published projectVersion ${item.id} must have status 0 or 1`)
    }
    if (present === releaseFields.length && item.isDeleted) {
      invalidBackup(`published projectVersion ${item.id} cannot be deleted`)
    }
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
    if (item.authorId && users.size > 0) assertReference(users, item.authorId, 'authorId')
  }
  for (const item of data.noteContents) {
    assertReference(noteInfos, item.noteInfoId, 'noteInfoId')
  }
  const confirmedLeaves = new Set<string>()
  for (const item of data.compressedNfts) {
    assertReference(merkleTrees, item.merkleTreeId, 'merkleTreeId')
    assertReference(projects, item.projectId, 'projectId')
    if (item.noteInfoId) assertReference(noteInfos, item.noteInfoId, 'noteInfoId')
    if (item.copyrightOwnerId && users.size > 0) {
      assertReference(users, item.copyrightOwnerId, 'copyrightOwnerId')
    }
    if (item.originalImageId) {
      assertReference(fileManagements, item.originalImageId, 'originalImageId')
    }
    if (item.capacityReserved === true && item.status !== 0) {
      invalidBackup(`compressedNft ${item.id} reserves capacity outside MINTING status`)
    }
    if (item.status === 0 && item.capacityReserved === false) {
      invalidBackup(`compressedNft ${item.id} is MINTING without a capacity reservation`)
    }
    if (item.status === 1 && item.leafIndex < 0) {
      invalidBackup(`compressedNft ${item.id} has an invalid confirmed leafIndex`)
    }
    if (item.status === 1) {
      const tree = merkleTrees.get(item.merkleTreeId)
      if (!tree) invalidBackup(`unknown merkleTreeId ${item.merkleTreeId}`)
      if (
        BigInt(item.leafIndex) >= BigInt(tree.totalMinted) ||
        BigInt(item.leafIndex) >= BigInt(tree.maxCapacity)
      ) {
        invalidBackup(`compressedNft ${item.id} leafIndex exceeds its tree cursor`)
      }
      const leafKey = `${item.merkleTreeId}:${item.leafIndex}`
      if (confirmedLeaves.has(leafKey)) {
        invalidBackup(`duplicate confirmed leafIndex ${leafKey}`)
      }
      confirmedLeaves.add(leafKey)
    }
  }

  const pendingReservationsByTree = new Map<string, bigint>()
  const confirmedRecordsByTree = new Map<string, bigint>()
  for (const item of data.compressedNfts) {
    if (item.status === 0 && item.capacityReserved !== false) {
      pendingReservationsByTree.set(
        item.merkleTreeId,
        (pendingReservationsByTree.get(item.merkleTreeId) ?? 0n) + 1n,
      )
    }
    if (item.status === 1) {
      confirmedRecordsByTree.set(
        item.merkleTreeId,
        (confirmedRecordsByTree.get(item.merkleTreeId) ?? 0n) + 1n,
      )
    }
  }
  for (const tree of data.merkleTrees) {
    const maxCapacity = BigInt(tree.maxCapacity)
    const totalMinted = BigInt(tree.totalMinted)
    const pendingReservations = pendingReservationsByTree.get(tree.id) ?? 0n
    const confirmedRecords = confirmedRecordsByTree.get(tree.id) ?? 0n
    if (maxCapacity <= 0n) {
      invalidBackup(`merkleTree ${tree.id} has a non-positive maxCapacity`)
    }
    if (totalMinted < 0n || totalMinted > maxCapacity) {
      invalidBackup(`merkleTree ${tree.id} has an invalid totalMinted`)
    }
    const upperRemaining = maxCapacity - totalMinted
    const lowerRemainingCandidate = upperRemaining - pendingReservations
    const lowerRemaining = lowerRemainingCandidate > 0n ? lowerRemainingCandidate : 0n
    if (upperRemaining < 0n) {
      invalidBackup(`merkleTree ${tree.id} reservations exceed maxCapacity`)
    }
    if (
      tree.remainingCapacity !== undefined &&
      (
        BigInt(tree.remainingCapacity) < lowerRemaining ||
        BigInt(tree.remainingCapacity) > upperRemaining
      )
    ) {
      invalidBackup(`merkleTree ${tree.id} has an inconsistent remainingCapacity`)
    }
    const effectiveRemaining = tree.remainingCapacity === undefined
      ? lowerRemaining
      : BigInt(tree.remainingCapacity)
    if (pendingReservations > maxCapacity - effectiveRemaining) {
      invalidBackup(`merkleTree ${tree.id} has more reservations than allocated capacity`)
    }
    if (confirmedRecords + pendingReservations > maxCapacity) {
      invalidBackup(`merkleTree ${tree.id} has more active cNFT records than maxCapacity`)
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
  assertUniqueField('username', data.users, (item) => item.username)
  assertUniqueField(
    'email',
    data.users.filter((item): item is typeof item & { email: string } => item.email !== null),
    (item) => item.email,
  )
  assertUniqueField(
    'walletAddress',
    data.users.filter(
      (item): item is typeof item & { walletAddress: string } => item.walletAddress !== null,
    ),
    (item) => item.walletAddress,
  )
  assertUniqueField('giftCard codeHash', data.giftCards, (item) => item.codeHash)
  assertUniqueField(
    'releaseId',
    data.projectVersions.filter(
      (item): item is typeof item & { releaseId: string } => item.releaseId !== null,
    ),
    (item) => item.releaseId,
  )
  assertUniqueField(
    'releaseHash',
    data.projectVersions.filter(
      (item): item is typeof item & { releaseHash: string } => item.releaseHash !== null,
    ),
    (item) => item.releaseHash,
  )
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

  if (parsed.data.version === '2.0.0') {
    for (const version of parsed.data.data.projectVersions) {
      version.status = 0
      version.releaseId = null
      version.releaseHash = null
      version.manifestVersion = null
      version.publishedAt = null
    }
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
