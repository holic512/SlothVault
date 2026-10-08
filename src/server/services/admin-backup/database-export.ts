/**
 * @file database-export.ts
 * @project SlothVault
 * @module Admin Database Backup Export
 * @description Exports a relation-closed portable 2.10 complete snapshot of membership entitlements, articles, project content, accounts, contracts, configuration, and transaction evidence.
 * @logic Read one repeatable transaction snapshot, retain member access and independent articles, include trash and disabled file records, serialize evidence BigInts and frozen contract identity, then validate the portable result.
 * @dependencies database unit-of-work, Prisma, HTTP JSON serialization, backup schema and validation
 * @index_tags admin,backup,database,export,snapshot,relations
 * @author holic512
 */
import 'server-only'
import { exportCommissionCollections } from '@/server/commissions/backup'

import { databaseSnapshotIsolationLevel } from '@/server/database/client'
import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { toJsonSafe } from '@/server/http/response'

import {
  DATABASE_BACKUP_VERSION,
  DATABASE_IMPORT_CONTENT_LENGTH_MAX_BYTES,
  RESTORE_COMMIT_CONFIG_KEY,
  DATABASE_TRANSACTION_MAX_WAIT_MS,
  DATABASE_TRANSACTION_TIMEOUT_MS,
  DEPRECATED_CONFIG_KEYS,
} from './constants'
import { backupDataSchema } from './database-schema'
import { validateBackupRelations } from './database-validation'

export async function exportDatabaseBackup() {
  const exportedAt = new Date().toISOString()
  const snapshot = await unitOfWork.execute(async (tx) => {
    const [
      users,
      pointTransactions,
      giftCardBatches,
      giftCards,
      membershipLevels,
      membershipGrants,
      articles,
    ] = await Promise.all([
      tx.user.findMany(),
      tx.pointTransaction.findMany(),
      tx.giftCardBatch.findMany(),
      tx.giftCard.findMany(),
      tx.membershipLevel.findMany(),
      tx.membershipGrant.findMany(),
      tx.article.findMany({ include: { allowedMemberships: true } }),
    ])
    const projects = await tx.project.findMany({ include: { readMemberships: true, downloadMemberships: true } })
    const projectIds = projects.map((item) => item.id)

    const [projectVersions, candidateMenus, projectHomes] =
      await Promise.all([
        tx.projectVersion.findMany({
          where: { projectId: { in: projectIds } },
        }),
        tx.projectMenu.findMany({
          where: { projectId: { in: projectIds } },
        }),
        tx.projectHome.findMany({
          where: { projectId: { in: projectIds } },
        }),
      ])

    const projectMenus = candidateMenus
    const projectVersionIds = projectVersions.map((item) => item.id)
    const categories = await tx.category.findMany({
      where: {
        projectVersionId: { in: projectVersionIds },
      },
    })
    const categoryIds = categories.map((item) => item.id)
    const noteInfos = await tx.noteInfo.findMany({
      where: { categoryId: { in: categoryIds } },
    })
    const noteInfoIds = noteInfos.map((item) => item.id)
    const noteContents = await tx.noteContent.findMany({
      where: { noteInfoId: { in: noteInfoIds } },
    })

    const [fileManagements, systemConfigs, systemHomepages, releaseCredentials, contracts] = await Promise.all([
      tx.fileManagement.findMany(),
      tx.systemConfig.findMany({ where: { configKey: { not: RESTORE_COMMIT_CONFIG_KEY } } }),
      tx.systemHomepage.findMany(),
      tx.releaseCredential.findMany({ where: { projectVersionId: { in: projectVersionIds } } }),
      tx.contract.findMany(),
    ])
    const credentialIds = releaseCredentials.map((item) => item.id)
    const contractIds = contracts.map((item) => item.id)
    const [releaseCredentialAttempts, contractCredentials, contractAdminAudits] = await Promise.all([
      tx.releaseCredentialAttempt.findMany({ where: { credentialId: { in: credentialIds } } }),
      tx.contractCredential.findMany({ where: { contractId: { in: contractIds } } }),
      tx.contractAdminAudit.findMany({ where: { contractId: { in: contractIds } } }),
    ])
    const contractCredentialIds = contractCredentials.map((item) => item.id)
    const contractCredentialAttempts = await tx.contractCredentialAttempt.findMany({
      where: { credentialId: { in: contractCredentialIds } },
    })

    const sourceIds = {
      NOTE_CONTENT: new Set(noteContents.map((item) => item.id)),
      PROJECT_HOME: new Set(projectHomes.map((item) => item.id)),
      PROJECT_MENU: new Set(projectMenus.map((item) => item.id)),
      ARTICLE: new Set(articles.map((item) => item.id)),
      SYSTEM_HOMEPAGE: new Set(systemHomepages.map((item) => item.id)),
      PROJECT_AVATAR: new Set(projects.map((item) => item.id)),
      USER_AVATAR: new Set(users.map((item) => item.id)),
      SYSTEM_CONFIG: new Set(systemConfigs.map((item) => item.id)),
    }
    const fileIds = new Set(fileManagements.map((item) => item.id))
    const fileReferences = (await tx.fileReference.findMany()).filter((item) => fileIds.has(item.fileId) && sourceIds[item.sourceType as keyof typeof sourceIds]?.has(item.sourceId))
    return {
      commissionCollections: await exportCommissionCollections(tx),
      fileReferences,
      users,
      pointTransactions,
      giftCardBatches,
      giftCards,
      membershipLevels,
      membershipGrants,
      articles,
      projects,
      projectVersions,
      categories,
      projectMenus,
      projectHomes,
      noteInfos,
      noteContents,
      fileManagements,
      systemConfigs: systemConfigs.filter((item) => !DEPRECATED_CONFIG_KEYS.has(item.configKey)),
      systemHomepages,
      contracts,
      contractAdminAudits,
      contractCredentials,
      contractCredentialAttempts,
      releaseCredentials,
      releaseCredentialAttempts,
    }
  }, {
    isolationLevel: databaseSnapshotIsolationLevel(),
    maxWait: DATABASE_TRANSACTION_MAX_WAIT_MS,
    timeout: DATABASE_TRANSACTION_TIMEOUT_MS,
    mode: 'read',
  })

  const portableSnapshot = {
    ...snapshot.commissionCollections,
    users: snapshot.users.map(({ id, ...item }) => ({
      ...item,
      id: id.toString(),
    })),
    pointTransactions: snapshot.pointTransactions.map(({ id, userId, ...item }) => ({
      ...item,
      id: id.toString(),
      userId: userId.toString(),
    })),
    giftCardBatches: snapshot.giftCardBatches.map(({ id, createdById, ...item }) => ({
      ...item,
      id: id.toString(),
      createdById: createdById.toString(),
    })),
    giftCards: snapshot.giftCards.map(({ id, batchId, redeemedById, ...item }) => ({
      ...item,
      id: id.toString(),
      batchId: batchId.toString(),
      redeemedById: redeemedById?.toString() ?? null,
    })),
    membershipLevels: snapshot.membershipLevels.map(({ id, ...item }) => ({
      ...item,
      id: id.toString(),
    })),
    membershipGrants: snapshot.membershipGrants.map(({
      id,
      userId,
      membershipLevelId,
      grantedByUserId,
      revokedByUserId,
      ...item
    }) => ({
      ...item,
      id: id.toString(),
      userId: userId.toString(),
      membershipLevelId: membershipLevelId.toString(),
      grantedByUserId: grantedByUserId?.toString() ?? null,
      revokedByUserId: revokedByUserId?.toString() ?? null,
    })),
    articles: snapshot.articles.map(({ id, requiredMembershipLevelId, allowedMemberships, ...item }) => ({
      ...item,
      id: id.toString(),
      requiredMembershipLevelId: requiredMembershipLevelId?.toString() ?? null,
      allowedMembershipLevelIds: (allowedMemberships ?? []).map((link) => String(link.membershipLevelId)),
    })),
    fileReferences: snapshot.fileReferences.map((item) => ({ ...item, id: String(item.id), fileId: String(item.fileId), sourceId: String(item.sourceId), projectId: item.projectId ? String(item.projectId) : null })),
    projects: snapshot.projects.map(({ id, readMemberships, downloadMemberships, ...item }) => ({
      ...item,
      readMembershipLevelIds: (readMemberships ?? []).map((link) => String(link.membershipLevelId)),
      downloadMembershipLevelIds: (downloadMemberships ?? []).map((link) => String(link.membershipLevelId)),
      id: id.toString(),
    })),
    projectVersions: snapshot.projectVersions.map(({
      id,
      projectId,
      documentRevision,
      ...item
    }) => {
      void documentRevision
      return {
        ...item,
        id: id.toString(),
        projectId: projectId.toString(),
      }
    }),
    categories: snapshot.categories.map(({ id, projectVersionId, ...item }) => ({
      ...item,
      id: id.toString(),
      projectVersionId: projectVersionId.toString(),
    })),
    projectMenus: snapshot.projectMenus.map(({ id, projectId, parentId, ...item }) => ({
      ...item,
      id: id.toString(),
      projectId: projectId.toString(),
      parentId: parentId?.toString() ?? null,
    })),
    projectHomes: snapshot.projectHomes.map(({ id, projectId, ...item }) => ({
      ...item,
      id: id.toString(),
      projectId: projectId.toString(),
    })),
    noteInfos: snapshot.noteInfos.map(({
      id,
      categoryId,
      authorId,
      contentRevision,
      ...item
    }) => {
      void contentRevision
      return {
        ...item,
        id: id.toString(),
        categoryId: categoryId.toString(),
        authorId: authorId?.toString() ?? null,
      }
    }),
    noteContents: snapshot.noteContents.map(({ id, noteInfoId, ...item }) => ({
      ...item,
      id: id.toString(),
      noteInfoId: noteInfoId.toString(),
    })),
    fileManagements: snapshot.fileManagements.map(({ id, ...item }) => ({
      ...item,
      id: id.toString(),
    })),
    systemConfigs: snapshot.systemConfigs.map(({ id, ...item }) => ({
      ...item,
      id: id.toString(),
    })),
    systemHomepages: snapshot.systemHomepages.map(({ id, ...item }) => ({
      ...item,
      id: id.toString(),
    })),
    contracts: snapshot.contracts.map(({
      id,
      issuerUserId,
      subjectUserId,
      attachmentFileId,
      commissionId, templateVersionId, sourceRecordId,
      ...item
    }) => ({
      ...item,
      id: id.toString(),
      issuerUserId: issuerUserId.toString(),
      subjectUserId: subjectUserId.toString(),
      attachmentFileId: attachmentFileId?.toString() ?? null,
      commissionId: commissionId?.toString() ?? null, templateVersionId: templateVersionId?.toString() ?? null, sourceRecordId: sourceRecordId?.toString() ?? null,
    })),
    contractAdminAudits: snapshot.contractAdminAudits.map(({
      id,
      contractId,
      actorUserId,
      ...item
    }) => ({
      ...item,
      id: id.toString(),
      contractId: contractId.toString(),
      actorUserId: actorUserId.toString(),
    })),
    contractCredentials: snapshot.contractCredentials.map(({ id, contractId, issuerUserId, ...item }) => ({
      ...item,
      id: id.toString(),
      contractId: contractId.toString(),
      issuerUserId: issuerUserId.toString(),
    })),
    contractCredentialAttempts: snapshot.contractCredentialAttempts.map(({
      id,
      credentialId,
      issuerUserId,
      ...item
    }) => ({
      ...item,
      id: id.toString(),
      credentialId: credentialId.toString(),
      issuerUserId: issuerUserId.toString(),
    })),
    releaseCredentials: snapshot.releaseCredentials.map(({ id, projectVersionId, noteContentId, issuerUserId, ...item }) => ({
      ...item,
      id: id.toString(),
      projectVersionId: projectVersionId.toString(),
      noteContentId: noteContentId?.toString() ?? null,
      issuerUserId: issuerUserId.toString(),
    })),
    releaseCredentialAttempts: snapshot.releaseCredentialAttempts.map(({
      id,
      credentialId,
      issuerUserId,
      ...item
    }) => ({
      ...item,
      id: id.toString(),
      credentialId: credentialId.toString(),
      issuerUserId: issuerUserId.toString(),
    })),
  }
  const data = backupDataSchema.parse(toJsonSafe(portableSnapshot))
  validateBackupRelations(data)
  const {
    merkleTrees: _legacyMerkleTrees,
    compressedNfts: _legacyCompressedNfts,
    ...activeData
  } = data
  void _legacyMerkleTrees
  void _legacyCompressedNfts

  const backup = { version: DATABASE_BACKUP_VERSION, exportedAt, data: activeData }
  if (Buffer.byteLength(JSON.stringify(backup), 'utf8') > DATABASE_IMPORT_CONTENT_LENGTH_MAX_BYTES) {
    throw new HttpError('Database backup exceeds the 50MB limit', 413, 413)
  }
  return backup
}
