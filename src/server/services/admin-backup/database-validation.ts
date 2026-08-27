/**
 * @file database-validation.ts
 * @project SlothVault
 * @module Admin Database Backup Validation
 * @description Validates cross-record backup relations, immutable release metadata, and database import payloads before mutation.
 * @logic Reject broken active relations, duplicate evidence identities, and oversized requests while ignoring deprecated Tree/cNFT data from legacy backups.
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
  const membershipLevels = mapById('membershipLevel', data.membershipLevels)
  const membershipGrants = mapById('membershipGrant', data.membershipGrants)
  mapById('article', data.articles)
  const projects = mapById('project', data.projects)
  const projectVersions = mapById('projectVersion', data.projectVersions)
  const categories = mapById('category', data.categories)
  const projectMenus = mapById('projectMenu', data.projectMenus)
  const projectHomes = mapById('projectHome', data.projectHomes)
  const noteInfos = mapById('noteInfo', data.noteInfos)
  const noteContents = mapById('noteContent', data.noteContents)
  const fileManagements = mapById('fileManagement', data.fileManagements)
  mapById('systemConfig', data.systemConfigs)
  mapById('systemHomepage', data.systemHomepages)
  const releaseCredentials = mapById('releaseCredential', data.releaseCredentials)
  mapById('releaseCredentialAttempt', data.releaseCredentialAttempts)
  const contracts = mapById('contract', data.contracts)
  mapById('contractAdminAudit', data.contractAdminAudits)
  const contractCredentials = mapById('contractCredential', data.contractCredentials)
  mapById('contractCredentialAttempt', data.contractCredentialAttempts)

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
  assertUniqueField('membershipLevel rank', data.membershipLevels, (item) => String(item.rank))
  for (const item of membershipGrants.values()) {
    assertReference(users, item.userId, 'membershipGrant userId')
    assertReference(membershipLevels, item.membershipLevelId, 'membershipGrant membershipLevelId')
    if (item.grantedByUserId) assertReference(users, item.grantedByUserId, 'membershipGrant grantedByUserId')
    if (item.revokedByUserId) assertReference(users, item.revokedByUserId, 'membershipGrant revokedByUserId')
    if (item.expiresAt && new Date(item.expiresAt).getTime() <= new Date(item.grantedAt).getTime()) {
      invalidBackup(`membershipGrant ${item.id} expires before its grant time`)
    }
  }
  for (const item of data.articles) {
    if (item.status === 1 && (!item.publishedAt || item.isDeleted)) {
      invalidBackup(`published article ${item.id} must be visible and have publishedAt`)
    }
    if (item.requiredMembershipLevelId) {
      assertReference(membershipLevels, item.requiredMembershipLevelId, 'article requiredMembershipLevelId')
    }
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
  for (const item of data.releaseCredentials) {
    const version = projectVersions.get(item.projectVersionId)
    if (!version) {
      invalidBackup(`unknown releaseCredential projectVersionId ${item.projectVersionId}`)
    }
    assertReference(users, item.issuerUserId, 'releaseCredential issuerUserId')

    if (item.subjectType === 'NOTE_CONTENT') {
      if (
        !item.noteContentId ||
        !item.subjectId ||
        !item.subjectHash ||
        item.subjectManifestVersion === null
      ) {
        invalidBackup(`releaseCredential ${item.id} has incomplete note-content subject metadata`)
      }
      const content = noteContents.get(item.noteContentId)
      if (!content) {
        invalidBackup(`unknown releaseCredential noteContentId ${item.noteContentId}`)
      }
      if (!content.evidenceId || content.evidenceId !== item.subjectId) {
        invalidBackup(`releaseCredential ${item.id} does not match noteContent evidenceId`)
      }
      const note = noteInfos.get(content.noteInfoId)
      const category = note ? categories.get(note.categoryId) : undefined
      if (!note || !category || category.projectVersionId !== item.projectVersionId) {
        invalidBackup(`releaseCredential ${item.id} note content belongs to another project version`)
      }
      continue
    }

    if (item.noteContentId !== null) {
      invalidBackup(`project-version releaseCredential ${item.id} cannot reference note content`)
    }
    if (!version.releaseId || !version.releaseHash || version.manifestVersion === null) {
      invalidBackup(`releaseCredential ${item.id} references an unpublished project version`)
    }
    if (
      (item.subjectId !== null && item.subjectId !== version.releaseId) ||
      (item.subjectHash !== null && item.subjectHash !== version.releaseHash) ||
      (item.subjectManifestVersion !== null && item.subjectManifestVersion !== version.manifestVersion)
    ) {
      invalidBackup(`releaseCredential ${item.id} does not match project version release metadata`)
    }
  }
  for (const item of data.releaseCredentialAttempts) {
    assertReference(releaseCredentials, item.credentialId, 'releaseCredentialAttempt credentialId')
    assertReference(users, item.issuerUserId, 'releaseCredentialAttempt issuerUserId')
  }
  for (const item of data.contracts) {
    assertReference(users, item.issuerUserId, 'contract issuerUserId')
    assertReference(users, item.subjectUserId, 'contract subjectUserId')
    if (item.attachmentFileId) assertReference(fileManagements, item.attachmentFileId, 'contract attachmentFileId')
    if (Boolean(item.attachmentFileId) !== Boolean(item.attachmentHash)) {
      invalidBackup(`contract ${item.id} has partial attachment metadata`)
    }
    if (item.status === 0 && (item.installationId || item.issuedAt || item.signedAt || item.contractHash)) {
      invalidBackup(`draft contract ${item.id} has frozen metadata`)
    }
    if (item.status === 1 && (!item.installationId || !item.issuedAt || item.signedAt || item.contractHash)) {
      invalidBackup(`pending contract ${item.id} has invalid signature metadata`)
    }
    if (item.status === 2 && (!item.installationId || !item.issuedAt || !item.signedAt || !item.contractHash)) {
      invalidBackup(`signed contract ${item.id} is missing immutable hash metadata`)
    }
    if (item.status === -1 && (!item.issuedAt || !item.declinedAt || item.contractHash)) {
      invalidBackup(`declined contract ${item.id} has invalid response metadata`)
    }
    if (item.status === -2 && !item.cancelledAt) {
      invalidBackup(`cancelled contract ${item.id} is missing cancellation metadata`)
    }
  }
  for (const item of data.contractCredentials) {
    assertReference(contracts, item.contractId, 'contractCredential contractId')
    assertReference(users, item.issuerUserId, 'contractCredential issuerUserId')
  }
  for (const item of data.contractAdminAudits) {
    assertReference(contracts, item.contractId, 'contractAdminAudit contractId')
    assertReference(users, item.actorUserId, 'contractAdminAudit actorUserId')
  }
  for (const item of data.contractCredentialAttempts) {
    assertReference(contractCredentials, item.credentialId, 'contractCredentialAttempt credentialId')
    assertReference(users, item.issuerUserId, 'contractCredentialAttempt issuerUserId')
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
  assertUniqueField('contractId', data.contracts, (item) => item.contractId)
  assertUniqueField(
    'contract attachmentFileId',
    data.contracts.filter((item): item is typeof item & { attachmentFileId: string } => item.attachmentFileId !== null),
    (item) => item.attachmentFileId,
  )
  assertUniqueField(
    'contractCredential contract/network',
    data.contractCredentials,
    (item) => `${item.contractId}:${item.network}`,
  )
  assertUniqueField(
    'contractCredential transactionSignature',
    data.contractCredentials.filter((item): item is typeof item & { transactionSignature: string } => item.transactionSignature !== null),
    (item) => item.transactionSignature,
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
  assertUniqueField(
    'noteContent evidenceId',
    data.noteContents.filter(
      (item): item is typeof item & { evidenceId: string } => item.evidenceId !== null,
    ),
    (item) => item.evidenceId,
  )
  assertUniqueField(
    'releaseCredential subject/network',
    data.releaseCredentials,
    (item) => {
      const version = projectVersions.get(item.projectVersionId)
      const subjectId = item.subjectId || version?.releaseId || ''
      return `${item.subjectType}:${subjectId}:${item.network}`
    },
  )
  assertUniqueField(
    'releaseCredential transactionSignature',
    data.releaseCredentials.filter(
      (item): item is typeof item & { transactionSignature: string } =>
        item.transactionSignature !== null,
    ),
    (item) => item.transactionSignature,
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
