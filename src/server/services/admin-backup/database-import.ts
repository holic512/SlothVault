/**
 * @file database-import.ts
 * @project SlothVault
 * @module Admin Database Backup Import
 * @description Imports a validated portable database backup in insert or overwrite mode while preserving immutable release identities.
 * @logic Map old identifiers to new records, preserve release metadata, rebuild each published manifest after ID remapping, reject identity/hash drift, and commit all records atomically.
 * @dependencies database unit-of-work, server/http/errors, project-version release service, backup schema, backup validation, business-data deletion
 * @index_tags admin,backup,database,import,restore,id-mapping
 * @author holic512
 */
import 'server-only'

import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { invalidatePublicArticleCache } from '@/server/services/public-article-cache'
import { invalidatePublicProjectCache } from '@/server/services/public-project-cache'
import {
  buildReleaseManifest,
  loadReleaseTree,
} from '@/server/services/project-version-release'

import {
  DATABASE_TRANSACTION_MAX_WAIT_MS,
  DATABASE_TRANSACTION_TIMEOUT_MS,
  DEPRECATED_CONFIG_KEYS,
} from './constants'
import { deleteBusinessData } from './database-delete'
import type {
  BackupData,
  DatabaseImportPayload,
} from './database-schema'
import { hasDatabaseErrorCode } from './database-validation'

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

function requiredMappedId(map: Map<string, number>, id: string, label: string) {
  const mapped = map.get(id)
  if (!mapped) throw new Error(`Validated ${label} mapping is missing`)
  return mapped
}

export async function importDatabaseBackup(payload: DatabaseImportPayload) {
  const { data, mode, version } = payload
  const primaryContentIds = version === '2.0.0' ? selectedPrimaryContentIds(data) : new Map()
  const ignoredLegacy = {
    merkleTrees: data.merkleTrees.length,
    compressedNfts: data.compressedNfts.length,
    deprecatedConfigs: data.systemConfigs.filter((item) => DEPRECATED_CONFIG_KEYS.has(item.configKey)).length,
  }

  try {
    const result = await unitOfWork.execute(async (tx) => {
    if (mode === 'overwrite') await deleteBusinessData(tx)

    const ids = {
      users: new Map<string, number>(),
      pointTransactions: new Map<string, number>(),
      giftCardBatches: new Map<string, number>(),
      giftCards: new Map<string, number>(),
      membershipLevels: new Map<string, number>(),
      membershipGrants: new Map<string, number>(),
      articles: new Map<string, number>(),
      projects: new Map<string, number>(),
      projectVersions: new Map<string, number>(),
      categories: new Map<string, number>(),
      projectMenus: new Map<string, number>(),
      projectHomes: new Map<string, number>(),
      noteInfos: new Map<string, number>(),
      noteContents: new Map<string, number>(),
      fileManagements: new Map<string, number>(),
      systemConfigs: new Map<string, number>(),
      systemHomepages: new Map<string, number>(),
      contracts: new Map<string, number>(),
      contractCredentials: new Map<string, number>(),
      contractCredentialAttempts: new Map<string, number>(),
      releaseCredentials: new Map<string, number>(),
      releaseCredentialAttempts: new Map<string, number>(),
    }
    const importingAdmin = await tx.user.findFirst({
      where: { role: 'ADMIN', status: 1 },
      orderBy: { id: 'asc' },
      select: { id: true },
    })
    if (!importingAdmin) throw new HttpError('Active administrator not found', 409, 409)

    for (const item of data.users) {
      const user = await tx.user.upsert({
        where: { username: item.username },
        update: {
          password: item.password,
          passwordConfigured: item.passwordConfigured,
          email: item.email,
          displayName: item.displayName,
          avatar: item.avatar,
          bio: item.bio,
          role: item.role,
          status: item.status,
          pointsBalance: item.pointsBalance,
          walletAddress: item.walletAddress,
          lastLoginAt: item.lastLoginAt ? new Date(item.lastLoginAt) : null,
          updatedAt: new Date(item.updatedAt),
        },
        create: {
          username: item.username,
          password: item.password,
          passwordConfigured: item.passwordConfigured,
          email: item.email,
          displayName: item.displayName,
          avatar: item.avatar,
          bio: item.bio,
          role: item.role,
          status: item.status,
          pointsBalance: item.pointsBalance,
          walletAddress: item.walletAddress,
          lastLoginAt: item.lastLoginAt ? new Date(item.lastLoginAt) : null,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        },
      })
      ids.users.set(item.id, user.id)
    }

    for (const item of data.membershipLevels) {
      const level = await tx.membershipLevel.create({
        data: {
          name: item.name,
          rank: item.rank,
          pricePoints: item.pricePoints,
          validityDays: item.validityDays,
          status: item.status,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        },
      })
      ids.membershipLevels.set(item.id, level.id)
    }

    for (const item of data.pointTransactions) {
      const record = await tx.pointTransaction.create({
        data: {
          userId: requiredMappedId(ids.users, item.userId, 'pointTransaction userId'),
          amount: item.amount,
          balanceAfter: item.balanceAfter,
          type: item.type,
          referenceId: item.referenceId,
          description: item.description,
          createdAt: new Date(item.createdAt),
        },
      })
      ids.pointTransactions.set(item.id, record.id)
    }

    for (const item of data.giftCardBatches) {
      const record = await tx.giftCardBatch.create({
        data: {
          name: item.name,
          points: item.points,
          quantity: item.quantity,
          expiresAt: item.expiresAt ? new Date(item.expiresAt) : null,
          status: item.status,
          createdById: requiredMappedId(ids.users, item.createdById, 'giftCardBatch createdById'),
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        },
      })
      ids.giftCardBatches.set(item.id, record.id)
    }

    for (const item of data.giftCards) {
      const record = await tx.giftCard.create({
        data: {
          batchId: requiredMappedId(ids.giftCardBatches, item.batchId, 'giftCard batchId'),
          codeHash: item.codeHash,
          codeHint: item.codeHint,
          status: item.status,
          redeemedById: item.redeemedById
            ? requiredMappedId(ids.users, item.redeemedById, 'giftCard redeemedById')
            : null,
          redeemedAt: item.redeemedAt ? new Date(item.redeemedAt) : null,
          createdAt: new Date(item.createdAt),
        },
      })
      ids.giftCards.set(item.id, record.id)
    }

    for (const item of data.membershipGrants) {
      const record = await tx.membershipGrant.create({
        data: {
          userId: requiredMappedId(ids.users, item.userId, 'membershipGrant userId'),
          membershipLevelId: requiredMappedId(
            ids.membershipLevels,
            item.membershipLevelId,
            'membershipGrant membershipLevelId',
          ),
          source: item.source,
          pointsCost: item.pointsCost,
          grantedByUserId: item.grantedByUserId
            ? requiredMappedId(ids.users, item.grantedByUserId, 'membershipGrant grantedByUserId')
            : null,
          grantedAt: new Date(item.grantedAt),
          expiresAt: item.expiresAt ? new Date(item.expiresAt) : null,
          revokedAt: item.revokedAt ? new Date(item.revokedAt) : null,
          revokedByUserId: item.revokedByUserId
            ? requiredMappedId(ids.users, item.revokedByUserId, 'membershipGrant revokedByUserId')
            : null,
        },
      })
      ids.membershipGrants.set(item.id, record.id)
    }

    for (const item of data.articles) {
      const record = await tx.article.create({
        data: {
          title: item.title,
          summary: item.summary,
          cover: item.cover,
          content: item.content,
          status: item.status,
          requiredMembershipLevelId: item.requiredMembershipLevelId
            ? requiredMappedId(
              ids.membershipLevels,
              item.requiredMembershipLevelId,
              'article requiredMembershipLevelId',
            )
            : null,
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
          isDeleted: item.isDeleted,
        },
      })
      ids.articles.set(item.id, record.id)
    }

    for (const item of data.projects) {
      const created = await tx.project.create({
        data: {
          projectName: item.projectName,
          avatar: item.avatar,
          weight: item.weight,
          status: item.status,
          requireAuth: false,
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
          releaseId: item.releaseId,
          releaseHash: item.releaseHash,
          manifestVersion: item.manifestVersion,
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
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
          authorId: item.authorId
            ? ids.users.get(item.authorId) ?? importingAdmin.id
            : null,
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
          evidenceId: item.evidenceId,
          content: item.content,
          versionNote: item.versionNote,
          isPrimary: version === '2.0.0' ? false : item.isPrimary,
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
      if (DEPRECATED_CONFIG_KEYS.has(item.configKey)) continue
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

    for (const item of data.contracts) {
      const record = await tx.contract.create({
        data: {
          contractId: item.contractId,
          installationId: item.installationId,
          issuerUserId: requiredMappedId(ids.users, item.issuerUserId, 'contract issuerUserId'),
          subjectUserId: requiredMappedId(ids.users, item.subjectUserId, 'contract subjectUserId'),
          title: item.title,
          body: item.body,
          bodyHash: item.bodyHash,
          contractHash: item.contractHash,
          attachmentFileId: item.attachmentFileId
            ? requiredMappedId(ids.fileManagements, item.attachmentFileId, 'contract attachmentFileId')
            : null,
          attachmentHash: item.attachmentHash,
          partyCommitment: item.partyCommitment,
          status: item.status,
          issuedAt: item.issuedAt ? new Date(item.issuedAt) : null,
          signedAt: item.signedAt ? new Date(item.signedAt) : null,
          signedSessionId: item.signedSessionId,
          signedIp: item.signedIp,
          signedUserAgent: item.signedUserAgent,
          declinedAt: item.declinedAt ? new Date(item.declinedAt) : null,
          declineReason: item.declineReason,
          cancelledAt: item.cancelledAt ? new Date(item.cancelledAt) : null,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        },
      })
      ids.contracts.set(item.id, record.id)
    }

    let contractAdminAuditCount = 0
    for (const item of data.contractAdminAudits) {
      await tx.contractAdminAudit.create({
        data: {
          contractId: requiredMappedId(ids.contracts, item.contractId, 'contractAdminAudit contractId'),
          actorUserId: requiredMappedId(ids.users, item.actorUserId, 'contractAdminAudit actorUserId'),
          action: item.action,
          createdAt: new Date(item.createdAt),
        },
      })
      contractAdminAuditCount += 1
    }

    for (const item of data.contractCredentials) {
      const record = await tx.contractCredential.create({
        data: {
          contractId: requiredMappedId(ids.contracts, item.contractId, 'contractCredential contractId'),
          issuerUserId: requiredMappedId(ids.users, item.issuerUserId, 'contractCredential issuerUserId'),
          network: item.network,
          signerAddress: item.signerAddress,
          memo: item.memo,
          transactionSignature: item.transactionSignature,
          status: item.status,
          slot: item.slot ? BigInt(item.slot) : null,
          blockTime: item.blockTime ? new Date(item.blockTime) : null,
          feeLamports: item.feeLamports ? BigInt(item.feeLamports) : null,
          finalizedAt: item.finalizedAt ? new Date(item.finalizedAt) : null,
          lastVerifiedAt: item.lastVerifiedAt ? new Date(item.lastVerifiedAt) : null,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        },
      })
      ids.contractCredentials.set(item.id, record.id)
    }

    for (const item of data.contractCredentialAttempts) {
      const record = await tx.contractCredentialAttempt.create({
        data: {
          credentialId: requiredMappedId(ids.contractCredentials, item.credentialId, 'contractCredentialAttempt credentialId'),
          issuerUserId: requiredMappedId(ids.users, item.issuerUserId, 'contractCredentialAttempt issuerUserId'),
          signerAddress: item.signerAddress,
          memo: item.memo,
          messageHash: item.messageHash,
          recentBlockhash: item.recentBlockhash,
          lastValidBlockHeight: BigInt(item.lastValidBlockHeight),
          transactionSignature: item.transactionSignature,
          status: item.status,
          failureCode: item.failureCode,
          failureMessage: item.failureMessage,
          expiresAt: new Date(item.expiresAt),
          submittedAt: item.submittedAt ? new Date(item.submittedAt) : null,
          finalizedAt: item.finalizedAt ? new Date(item.finalizedAt) : null,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        },
      })
      ids.contractCredentialAttempts.set(item.id, record.id)
    }

    for (const item of data.releaseCredentials) {
      const sourceVersion = data.projectVersions.find((version) => version.id === item.projectVersionId)
      const subjectId = item.subjectId || sourceVersion?.releaseId
      const subjectHash = item.subjectHash || sourceVersion?.releaseHash
      const subjectManifestVersion = item.subjectManifestVersion || sourceVersion?.manifestVersion
      if (!subjectId || !subjectHash || !subjectManifestVersion) {
        throw new HttpError('Backup evidence subject metadata is incomplete', 409, 409)
      }
      const record = await tx.releaseCredential.create({
        data: {
          projectVersionId: requiredMappedId(ids.projectVersions, item.projectVersionId, 'releaseCredential projectVersionId'),
          noteContentId: item.noteContentId
            ? requiredMappedId(ids.noteContents, item.noteContentId, 'releaseCredential noteContentId')
            : null,
          issuerUserId: requiredMappedId(ids.users, item.issuerUserId, 'releaseCredential issuerUserId'),
          subjectType: item.subjectType,
          subjectId,
          subjectHash,
          subjectManifestVersion,
          network: item.network,
          signerAddress: item.signerAddress,
          memo: item.memo,
          transactionSignature: item.transactionSignature,
          status: item.status,
          slot: item.slot ? BigInt(item.slot) : null,
          blockTime: item.blockTime ? new Date(item.blockTime) : null,
          feeLamports: item.feeLamports ? BigInt(item.feeLamports) : null,
          finalizedAt: item.finalizedAt ? new Date(item.finalizedAt) : null,
          lastVerifiedAt: item.lastVerifiedAt ? new Date(item.lastVerifiedAt) : null,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        },
      })
      ids.releaseCredentials.set(item.id, record.id)
    }

    for (const item of data.releaseCredentialAttempts) {
      const record = await tx.releaseCredentialAttempt.create({
        data: {
          credentialId: requiredMappedId(ids.releaseCredentials, item.credentialId, 'releaseCredentialAttempt credentialId'),
          issuerUserId: requiredMappedId(ids.users, item.issuerUserId, 'releaseCredentialAttempt issuerUserId'),
          signerAddress: item.signerAddress,
          memo: item.memo,
          messageHash: item.messageHash,
          recentBlockhash: item.recentBlockhash,
          lastValidBlockHeight: BigInt(item.lastValidBlockHeight),
          transactionSignature: item.transactionSignature,
          status: item.status,
          failureCode: item.failureCode,
          failureMessage: item.failureMessage,
          expiresAt: new Date(item.expiresAt),
          submittedAt: item.submittedAt ? new Date(item.submittedAt) : null,
          finalizedAt: item.finalizedAt ? new Date(item.finalizedAt) : null,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        },
      })
      ids.releaseCredentialAttempts.set(item.id, record.id)
    }

    for (const item of data.projectVersions) {
      if (!item.publishedAt || !item.releaseId || !item.releaseHash) continue
      const mappedVersionId = requiredMappedId(
        ids.projectVersions,
        item.id,
        'projectVersionId',
      )
      const source = await loadReleaseTree(tx, mappedVersionId)
      if (!source) throw new Error('Imported project version mapping is missing')
      const built = buildReleaseManifest(source, item.releaseId)
      if (built.issues.length > 0 || built.hash !== item.releaseHash) {
        throw new HttpError('Backup release integrity verification failed', 409, 409, {
          reason: 'BACKUP_RELEASE_INTEGRITY_FAILED',
          projectVersionId: item.id,
          storedHash: item.releaseHash,
          computedHash: built.hash,
          issues: built.issues,
        })
      }
    }

    return {
      message: 'Database import completed successfully',
      mode,
      imported: {
        users: ids.users.size,
        pointTransactions: ids.pointTransactions.size,
        giftCardBatches: ids.giftCardBatches.size,
        giftCards: ids.giftCards.size,
        membershipLevels: ids.membershipLevels.size,
        membershipGrants: ids.membershipGrants.size,
        articles: ids.articles.size,
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
        contracts: ids.contracts.size,
        contractAdminAudits: contractAdminAuditCount,
        contractCredentials: ids.contractCredentials.size,
        contractCredentialAttempts: ids.contractCredentialAttempts.size,
        releaseCredentials: ids.releaseCredentials.size,
        releaseCredentialAttempts: ids.releaseCredentialAttempts.size,
      },
      ignoredLegacy,
    }
    }, {
      maxWait: DATABASE_TRANSACTION_MAX_WAIT_MS,
      timeout: DATABASE_TRANSACTION_TIMEOUT_MS,
    })
    await Promise.all([invalidatePublicArticleCache(), invalidatePublicProjectCache()])
    return result
  } catch (error) {
    if (hasDatabaseErrorCode(error, 'P2002')) {
      throw new HttpError('Backup data conflicts with existing records', 409, 409, {
        reason: 'BACKUP_UNIQUE_CONFLICT',
      })
    }
    throw error
  }
}
