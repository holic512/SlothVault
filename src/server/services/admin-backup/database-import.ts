/**
 * @file database-import.ts
 * @project SlothVault
 * @module Admin Database Backup Import
 * @description Imports a validated portable database backup through a full overwrite restore while preserving immutable release identities.
 * @logic Preflight conflicts, preserve all administrator wallet credentials and quotas, restore wallet bindings in deterministic order and note tags, map old identifiers to new records, preserve release metadata, rebuild each published manifest after ID remapping, reject identity/hash drift, and expose a transaction-scoped import for coordinated file recovery.
 * @dependencies database unit-of-work, server/http/errors, project-version release service, backup schema, backup validation, business-data deletion
 * @index_tags admin,backup,database,import,restore,id-mapping
 * @author holic512
 */
import 'server-only'
import { backfillUserAttribution } from '@/server/services/user-deletion'
import { unitOfWork } from '@/server/database/unit-of-work'
import { DATABASE_BACKUP_VERSION, DATABASE_TRANSACTION_MAX_WAIT_MS, DATABASE_TRANSACTION_TIMEOUT_MS } from './constants'
import { verifyRestoredPublications } from './publication-validation'
import { backupMap, recordStore } from './record-store'
import { parseReleaseManifest } from '@/server/services/release-manifest'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { inspectImportAccounts, prepareRestoreAccounts, type DatabaseRestoreOptions } from './accounts'
import { importCommissionCollections } from '@/server/commissions/backup'

import { HttpError } from '@/server/http/errors'
import { invalidatePublicArticleCache } from '@/server/services/public-article-cache'
import { invalidatePublicProjectCache } from '@/server/services/public-project-cache'
import {
  buildReleaseManifest,
  loadReleaseTree,
} from '@/server/services/project-version-release'

import {
  DEPRECATED_CONFIG_KEYS,
} from './constants'
import { deleteBusinessData } from './database-delete'
import type {
  BackupData,
  DatabaseImportPayload,
} from './database-schema'

function orderedMenus(data: BackupData) {
  const store = recordStore(data.projectMenus)
  if (store) {
    store.db.exec(`WITH RECURSIVE tree(id, depth) AS (SELECT id, 0 FROM records WHERE collection='projectMenus' AND json_extract(json,'$.parentId') IS NULL UNION ALL SELECT r.id, t.depth+1 FROM records r JOIN tree t ON json_extract(r.json,'$.parentId')=t.id WHERE r.collection='projectMenus') INSERT INTO records(collection,id,json) SELECT '$orderedMenus',r.id,r.json FROM tree t JOIN records r ON r.collection='projectMenus' AND r.id=t.id ORDER BY t.depth, CAST(t.id AS INTEGER)`)
    return store.rows<BackupData['projectMenus'][number]>('$orderedMenus')
  }
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

function requiredMappedId(map: Map<string, number>, id: string, label: string) {
  const mapped = map.get(id)
  if (!mapped) throw new Error(`Validated ${label} mapping is missing`)
  return mapped
}

export async function importDatabaseRecords(tx: Prisma.TransactionClient, payload: DatabaseImportPayload, options: DatabaseRestoreOptions = {}) {
  const { mode, data } = payload
  const policy = await inspectImportAccounts(tx, payload, options)
  await deleteBusinessData(tx)
  await prepareRestoreAccounts(tx, payload, policy, options)

  const ids = {
    users: backupMap<number>(data.users),
    pointTransactions: backupMap<number>(data.pointTransactions),
    giftCardBatches: backupMap<number>(data.giftCardBatches),
    giftCards: backupMap<number>(data.giftCards),
    membershipLevels: backupMap<number>(data.membershipLevels),
    membershipGrants: backupMap<number>(data.membershipGrants),
    articles: backupMap<number>(data.articles),
    projects: backupMap<number>(data.projects),
    projectVersions: backupMap<number>(data.projectVersions),
    categories: backupMap<number>(data.categories),
    projectMenus: backupMap<number>(data.projectMenus),
    projectHomes: backupMap<number>(data.projectHomes),
    noteInfos: backupMap<number>(data.noteInfos),
    noteContents: backupMap<number>(data.noteContents),
    fileManagements: backupMap<number>(data.fileManagements),
    systemConfigs: backupMap<number>(data.systemConfigs),
    systemHomepages: backupMap<number>(data.systemHomepages),
    contracts: backupMap<number>(data.contracts),
    contractCredentials: backupMap<number>(data.contractCredentials),
    contractCredentialAttempts: backupMap<number>(data.contractCredentialAttempts),
    releaseCredentials: backupMap<number>(data.releaseCredentials),
    releaseCredentialAttempts: backupMap<number>(data.releaseCredentialAttempts),
  }

  for (const item of data.users) {
    const user = await tx.user.upsert({
      where: { username: item.username },
      update: {
        username: item.id === policy.preservedSourceId ? policy.admin.username : item.username,
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
        usernameChangeMonth: item.usernameChangeMonth,
        usernameChangeCount: item.usernameChangeCount,
        credentialsRevision: item.credentialsRevision,
        lastLoginAt: item.lastLoginAt ? new Date(item.lastLoginAt) : null,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
        ...(item.id === policy.preservedSourceId ? {
          password: policy.admin.password,
          passwordConfigured: policy.admin.passwordConfigured,
          email: policy.admin.email,
          walletAddress: policy.admin.walletAddress,
          usernameChangeMonth: policy.admin.usernameChangeMonth,
          usernameChangeCount: policy.admin.usernameChangeCount,
          credentialsRevision: policy.admin.credentialsRevision,
          role: 'ADMIN', status: 1,
        } : {}),
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
        usernameChangeMonth: item.usernameChangeMonth,
        usernameChangeCount: item.usernameChangeCount,
        credentialsRevision: item.credentialsRevision,
        lastLoginAt: item.lastLoginAt ? new Date(item.lastLoginAt) : null,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
      },
    })
    ids.users.set(item.id, user.id)
  }

  // Insert in source ID order to preserve the deterministic oldest-address projection on timestamp ties.
  const walletRows = recordStore(data.userWallets)?.sorted(() => data.userWallets, (a, b) => Number(BigInt(a.id) - BigInt(b.id))) ?? [...data.userWallets].sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)))
  for (const wallet of walletRows) {
    const userId = requiredMappedId(ids.users, wallet.userId, 'wallet user')
    if (userId !== policy.admin.id) await tx.userWallet.create({ data: { userId, address: wallet.address, createdAt: new Date(wallet.createdAt) } })
  }

  for (const item of data.userDeletionRecords) {
    const { id: _sourceId, ...record } = item
    void _sourceId
    await tx.userDeletionRecord.upsert({ where: { publicId: item.publicId }, update: {}, create: { ...record, userCreatedAt: new Date(item.userCreatedAt), deletedAt: new Date(item.deletedAt) } })
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
        attributionJson: item.attributionJson,
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
        attributionJson: item.attributionJson,
        name: item.name,
        points: item.points,
        quantity: item.quantity,
        expiresAt: item.expiresAt ? new Date(item.expiresAt) : null,
        status: item.status,
        createdById: item.createdById ? requiredMappedId(ids.users, item.createdById, 'giftCardBatch createdById') : null,
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
        attributionJson: item.attributionJson,
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
    const allowedIds = item.allowedMembershipLevelIds
    const record = await tx.article.create({
      data: {
        title: item.title,
        summary: item.summary,
        cover: item.cover,
        content: item.content,
        status: item.status,
        allowedMemberships: { create: allowedIds.map((id) => ({ membershipLevelId: requiredMappedId(ids.membershipLevels, id, 'article membership') })) },
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
        deletedAt: item.deletedAt ? new Date(item.deletedAt) : null,
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
        requireAuth: item.requireAuth,
        readAccessMode: item.readAccessMode,
        downloadAccessMode: item.downloadAccessMode,
        readMemberships: { create: item.readMembershipLevelIds.map((id) => ({ membershipLevelId: requiredMappedId(ids.membershipLevels, id, 'project read membership') })) },
        downloadMemberships: { create: item.downloadMembershipLevelIds.map((id) => ({ membershipLevelId: requiredMappedId(ids.membershipLevels, id, 'project download membership') })) },
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
        isDeleted: item.isDeleted,
        deletedAt: item.deletedAt ? new Date(item.deletedAt) : null,
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
        releaseManifestJson: item.releaseManifestJson,
        manifestVersion: item.manifestVersion,
        publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
        isDeleted: item.isDeleted,
        deletedAt: item.deletedAt ? new Date(item.deletedAt) : null,
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
        deletedAt: item.deletedAt ? new Date(item.deletedAt) : null,
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
        deletedAt: item.deletedAt ? new Date(item.deletedAt) : null,
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
        deletedAt: item.deletedAt ? new Date(item.deletedAt) : null,
      },
    })
    ids.projectHomes.set(item.id, created.id)
  }

  for (const item of data.noteInfos) {
    const created = await tx.noteInfo.create({
      data: {
        attributionJson: item.attributionJson,
        categoryId: requiredMappedId(ids.categories, item.categoryId, 'categoryId'),
        authorId: item.authorId
          ? ids.users.get(item.authorId) ?? null
          : null,
        noteTitle: item.noteTitle,
        tagsJson: JSON.stringify(item.tags),
        weight: item.weight,
        status: item.status,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
        isDeleted: item.isDeleted,
        deletedAt: item.deletedAt ? new Date(item.deletedAt) : null,
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
        isPrimary: item.isPrimary,
        status: item.status,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
        isDeleted: item.isDeleted,
        deletedAt: item.deletedAt ? new Date(item.deletedAt) : null,
      },
    })
    ids.noteContents.set(item.id, created.id)
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

  const commissionMaps: Record<string, Map<string, number>> = { ...ids }
  const commissionParentCounts = await importCommissionCollections(tx, data, commissionMaps, true)
  for (const item of data.contracts) {
    const record = await tx.contract.create({
      data: {
        attributionJson: item.attributionJson,
        commissionId: item.commissionId ? requiredMappedId(commissionMaps.commissions, item.commissionId, 'contract commission') : null,
        templateVersionId: item.templateVersionId ? requiredMappedId(commissionMaps.commissionTemplateVersions, item.templateVersionId, 'contract template') : null,
        documentType: item.documentType, sourceRecordId: null, snapshotJson: item.snapshotJson, snapshotHash: item.snapshotHash,
        providerSessionId: item.providerSessionId, providerIp: item.providerIp, providerUserAgent: item.providerUserAgent,
        contractId: item.contractId,
        installationId: item.installationId,
        issuerUserId: item.issuerUserId ? requiredMappedId(ids.users, item.issuerUserId, 'contract issuerUserId') : null,
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
        attributionJson: item.attributionJson,
        contractId: requiredMappedId(ids.contracts, item.contractId, 'contractAdminAudit contractId'),
        actorUserId: item.actorUserId ? requiredMappedId(ids.users, item.actorUserId, 'contractAdminAudit actorUserId') : null,
        action: item.action,
        createdAt: new Date(item.createdAt),
      },
    })
    contractAdminAuditCount += 1
  }

  for (const item of data.contractCredentials) {
    const record = await tx.contractCredential.create({
      data: {
        attributionJson: item.attributionJson,
        contractId: requiredMappedId(ids.contracts, item.contractId, 'contractCredential contractId'),
        issuerUserId: item.issuerUserId ? requiredMappedId(ids.users, item.issuerUserId, 'contractCredential issuerUserId') : null,
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
        attributionJson: item.attributionJson,
        credentialId: requiredMappedId(ids.contractCredentials, item.credentialId, 'contractCredentialAttempt credentialId'),
        issuerUserId: item.issuerUserId ? requiredMappedId(ids.users, item.issuerUserId, 'contractCredentialAttempt issuerUserId') : null,
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

  const commissionChildCounts = await importCommissionCollections(tx, data, commissionMaps, false)
  for (const contract of data.contracts) {
    if (!contract.sourceRecordId) continue
    const sourceMap = contract.documentType === 'CHANGE' ? commissionMaps.commissionChanges : commissionMaps.commissionAcceptances
    await tx.contract.update({ where: { id: requiredMappedId(ids.contracts, contract.id, 'contract') }, data: { sourceRecordId: requiredMappedId(sourceMap, contract.sourceRecordId, 'contract source record') } })
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
        attributionJson: item.attributionJson,
        projectVersionId: requiredMappedId(ids.projectVersions, item.projectVersionId, 'releaseCredential projectVersionId'),
        noteContentId: item.noteContentId
          ? requiredMappedId(ids.noteContents, item.noteContentId, 'releaseCredential noteContentId')
          : null,
        issuerUserId: item.issuerUserId ? requiredMappedId(ids.users, item.issuerUserId, 'releaseCredential issuerUserId') : null,
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
        attributionJson: item.attributionJson,
        credentialId: requiredMappedId(ids.releaseCredentials, item.credentialId, 'releaseCredentialAttempt credentialId'),
        issuerUserId: item.issuerUserId ? requiredMappedId(ids.users, item.issuerUserId, 'releaseCredentialAttempt issuerUserId') : null,
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

  await backfillUserAttribution(tx, false)
  if (recordStore(data.projectVersions)) await verifyRestoredPublications(tx, data)
  else {
    for (const item of data.projectVersions) {
      if (!item.publishedAt || !item.releaseId || !item.releaseHash) continue
      const mappedVersionId = requiredMappedId(
        ids.projectVersions,
        item.id,
        'projectVersionId',
      )
      const source = await loadReleaseTree(tx, mappedVersionId)
      if (!source) throw new Error('Imported project version mapping is missing')
      const snapshot = parseReleaseManifest(item.releaseManifestJson)
      const built = buildReleaseManifest(source, snapshot.projectName)
      if (built.issues.length > 0 || built.hash !== item.releaseHash || Buffer.from(built.bytes!).toString('utf8') !== item.releaseManifestJson) {
        throw new HttpError('Backup release integrity verification failed', 409, 409, {
          reason: 'BACKUP_RELEASE_INTEGRITY_FAILED',
          projectVersionId: item.id,
          storedHash: item.releaseHash,
          computedHash: built.hash,
          issues: built.issues,
        })
      }
    }
  }

  let fileReferenceCount = 0
  const referenceSourceMaps = {
    NOTE_CONTENT: ids.noteContents, PROJECT_HOME: ids.projectHomes, PROJECT_MENU: ids.projectMenus,
    ARTICLE: ids.articles, SYSTEM_HOMEPAGE: ids.systemHomepages, PROJECT_AVATAR: ids.projects,
    USER_AVATAR: ids.users, SYSTEM_CONFIG: ids.systemConfigs,
  }
  {
    for (const item of data.fileReferences) {
      await tx.fileReference.create({ data: {
        fileId: requiredMappedId(ids.fileManagements, item.fileId, 'fileReference file'),
        sourceType: item.sourceType,
        sourceId: requiredMappedId(referenceSourceMaps[item.sourceType], item.sourceId, 'fileReference source'),
        projectId: item.projectId ? requiredMappedId(ids.projects, item.projectId, 'fileReference project') : null,
        usage: item.usage,
      } })
      fileReferenceCount += 1
    }
  }
  return {
    message: 'Database import completed successfully',
    mode,
    imported: {
      ...commissionParentCounts, ...commissionChildCounts,
      fileReferences: fileReferenceCount,
      users: ids.users.size,
      userDeletionRecords: data.userDeletionRecords.length,
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
  }
}

export async function invalidateBackupCaches() {
  try {
    await Promise.all([invalidatePublicArticleCache(), invalidatePublicProjectCache()])
    return [] as string[]
  } catch {
    return ['CACHE_REFRESH_FAILED']
  }
}

/** Transaction adapter for isolated business integration tests; live restores also coordinate the file journal. */
export async function importDatabaseBackup(payload: DatabaseImportPayload, options: DatabaseRestoreOptions = {}) {
  if (payload.version !== DATABASE_BACKUP_VERSION || payload.mode !== 'overwrite') throw new HttpError('Unsupported backup format', 400, 400, { reason: 'BACKUP_UNSUPPORTED_FORMAT' })
  const result = await unitOfWork.execute(tx => importDatabaseRecords(tx, payload, options), { maxWait: DATABASE_TRANSACTION_MAX_WAIT_MS, timeout: DATABASE_TRANSACTION_TIMEOUT_MS })
  return { ...result, warnings: await invalidateBackupCaches() }
}
