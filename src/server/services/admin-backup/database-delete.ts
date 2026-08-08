/**
 * @file database-delete.ts
 * @project SlothVault
 * @module Admin Database Business Data Deletion
 * @description Deletes all backup-managed business collections in referentially safe order.
 * @logic Remove dependent records before their parents and return exact per-collection and aggregate counts.
 * @dependencies Prisma transaction client
 * @index_tags admin,backup,database,delete,transaction
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

export async function deleteBusinessData(tx: Prisma.TransactionClient) {
  const giftCards = await tx.giftCard.deleteMany({})
  const giftCardBatches = await tx.giftCardBatch.deleteMany({})
  const pointTransactions = await tx.pointTransaction.deleteMany({})
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
    giftCards: giftCards.count,
    giftCardBatches: giftCardBatches.count,
    pointTransactions: pointTransactions.count,
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
