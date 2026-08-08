/**
 * @file database-export.ts
 * @project SlothVault
 * @module Admin Database Backup Export
 * @description Exports a relation-closed portable snapshot of accounts, content, points, files, configuration, and cNFT records.
 * @logic Read one repeatable transaction snapshot, close menu relations, serialize identifiers and BigInts, then validate the portable result.
 * @dependencies database unit-of-work, Prisma, HTTP JSON serialization, backup schema and validation
 * @index_tags admin,backup,database,export,snapshot,relations
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { databaseSnapshotIsolationLevel } from '@/server/database/client'
import { unitOfWork } from '@/server/database/unit-of-work'
import { toJsonSafe } from '@/server/http/response'

import {
  DATABASE_TRANSACTION_MAX_WAIT_MS,
  DATABASE_TRANSACTION_TIMEOUT_MS,
} from './constants'
import { backupDataSchema } from './database-schema'
import { validateBackupRelations } from './database-validation'

function relationClosedMenus<T extends {
  id: number
  parentId: number | null
  projectId: number
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
  const snapshot = await unitOfWork.execute(async (tx) => {
    const [users, pointTransactions, giftCardBatches, giftCards] = await Promise.all([
      tx.user.findMany(),
      tx.pointTransaction.findMany(),
      tx.giftCardBatch.findMany(),
      tx.giftCard.findMany(),
    ])
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
      users,
      pointTransactions,
      giftCardBatches,
      giftCards,
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
    isolationLevel: databaseSnapshotIsolationLevel(),
    maxWait: DATABASE_TRANSACTION_MAX_WAIT_MS,
    timeout: DATABASE_TRANSACTION_TIMEOUT_MS,
    mode: 'read',
  })

  const portableSnapshot = {
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
    projects: snapshot.projects.map(({ id, ...item }) => ({
      ...item,
      id: id.toString(),
    })),
    projectVersions: snapshot.projectVersions.map(({ id, projectId, ...item }) => ({
      ...item,
      id: id.toString(),
      projectId: projectId.toString(),
    })),
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
    merkleTrees: snapshot.merkleTrees.map(({ id, ...item }) => ({
      ...item,
      id: id.toString(),
    })),
    compressedNfts: snapshot.compressedNfts.map(({
      id,
      merkleTreeId,
      projectId,
      noteInfoId,
      copyrightOwnerId,
      originalImageId,
      ...item
    }) => ({
      ...item,
      id: id.toString(),
      merkleTreeId: merkleTreeId.toString(),
      projectId: projectId.toString(),
      noteInfoId: noteInfoId?.toString() ?? null,
      copyrightOwnerId: copyrightOwnerId?.toString() ?? null,
      originalImageId: originalImageId?.toString() ?? null,
    })),
  }
  const data = backupDataSchema.parse(toJsonSafe(portableSnapshot))
  validateBackupRelations(data)

  return {
    version: '2.0.0',
    exportedAt,
    data,
  }
}
