/**
 * @file database-delete.ts
 * @project SlothVault
 * @module Admin Database Business Data Deletion
 * @description Deletes all backup-managed business collections in referentially safe order.
 * @logic Remove dependent records before their parents and return exact per-collection and aggregate counts. Clear dynamic plugin rows and metadata before referenced core records.
 * @dependencies Prisma transaction client, plugin table registry
 * @index_tags admin,backup,database,delete,transaction
 * @author holic512
 */
import 'server-only'
import { clearPluginDataForRestore } from '@/server/plugins/backup'

import type { Prisma } from '@generated/prisma-postgresql/client'

export async function deleteBusinessData(tx: Prisma.TransactionClient) {
  await clearPluginDataForRestore(tx)
  const fileReferences = await tx.fileReference.deleteMany({})
  const articleMemberships = await tx.articleMembership.deleteMany({})
  const projectReadMemberships = await tx.projectReadMembership.deleteMany({})
  const projectDownloadMemberships = await tx.projectDownloadMembership.deleteMany({})
  const giftCards = { count: 0 }
  const giftCardBatches = { count: 0 }
  const pointTransactions = await tx.pointTransaction.deleteMany({})
  const articles = await tx.article.deleteMany({})
  const membershipGrants = await tx.membershipGrant.deleteMany({})
  const membershipLevels = await tx.membershipLevel.deleteMany({})
  const releaseCredentialAttempts = await tx.releaseCredentialAttempt.deleteMany({})
  const releaseCredentials = await tx.releaseCredential.deleteMany({})
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
    fileReferences: fileReferences.count,
    articleMemberships: articleMemberships.count,
    projectReadMemberships: projectReadMemberships.count,
    projectDownloadMemberships: projectDownloadMemberships.count,
    giftCards: giftCards.count,
    giftCardBatches: giftCardBatches.count,
    pointTransactions: pointTransactions.count,
    articles: articles.count,
    membershipGrants: membershipGrants.count,
    membershipLevels: membershipLevels.count,
    releaseCredentialAttempts: releaseCredentialAttempts.count,
    releaseCredentials: releaseCredentials.count,
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
