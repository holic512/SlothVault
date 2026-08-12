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
import { invalidatePublicProjectCache } from '@/server/services/public-project-cache'
import {
  buildReleaseManifest,
  loadReleaseTree,
} from '@/server/services/project-version-release'

import {
  DATABASE_TRANSACTION_MAX_WAIT_MS,
  DATABASE_TRANSACTION_TIMEOUT_MS,
  LEGACY_SIGNED_ATTEMPT_GRACE_MS,
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

  try {
    const result = await unitOfWork.execute(async (tx) => {
    if (mode === 'overwrite') await deleteBusinessData(tx)

    const ids = {
      users: new Map<string, number>(),
      pointTransactions: new Map<string, number>(),
      giftCardBatches: new Map<string, number>(),
      giftCards: new Map<string, number>(),
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
      merkleTrees: new Map<string, number>(),
      compressedNfts: new Map<string, number>(),
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
          content: item.content,
          versionNote: item.versionNote,
          isPrimary: version === '2.1.0' ? item.isPrimary : false,
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

    const pendingReservationsByTree = new Map<string, number>()
    for (const item of data.compressedNfts) {
      if (item.status !== 0 || item.capacityReserved === false) continue
      pendingReservationsByTree.set(
        item.merkleTreeId,
        (pendingReservationsByTree.get(item.merkleTreeId) ?? 0) + 1,
      )
    }

    for (const item of data.merkleTrees) {
      const maxCapacity = BigInt(item.maxCapacity)
      const derivedRemainingCandidate =
        maxCapacity - BigInt(item.totalMinted) - BigInt(pendingReservationsByTree.get(item.id) ?? 0)
      const derivedRemaining = derivedRemainingCandidate > 0n ? derivedRemainingCandidate : 0n
      const remainingCapacity = item.remainingCapacity
        ? BigInt(item.remainingCapacity)
        : derivedRemaining
      const record = await tx.merkleTree.create({
        data: {
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
          maxCapacity,
          remainingCapacity,
          capacityRevision: item.capacityRevision ?? 0,
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
      const record = await tx.compressedNft.create({
        data: {
          merkleTreeId: requiredMappedId(
            ids.merkleTrees,
            item.merkleTreeId,
            'merkleTreeId',
          ),
          projectId: requiredMappedId(ids.projects, item.projectId, 'projectId'),
          noteInfoId: item.noteInfoId
            ? requiredMappedId(ids.noteInfos, item.noteInfoId, 'noteInfoId')
            : null,
          copyrightOwnerId: item.copyrightOwnerId
            ? ids.users.get(item.copyrightOwnerId) ?? importingAdmin.id
            : null,
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
            : item.status === 0 && !item.mintTxSignature
              ? new Date()
              : item.status === 0
                ? new Date(Date.now() + LEGACY_SIGNED_ATTEMPT_GRACE_MS)
                : null,
          lastValidBlockHeight: item.lastValidBlockHeight
            ? BigInt(item.lastValidBlockHeight)
            : null,
          capacityReserved: item.capacityReserved ?? item.status === 0,
          status: item.status,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        },
      })
      ids.compressedNfts.set(item.id, record.id)
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
    await invalidatePublicProjectCache()
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
