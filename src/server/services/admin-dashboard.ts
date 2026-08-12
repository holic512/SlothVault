/**
 * @file admin-dashboard.ts
 * @project SlothVault
 * @module Admin Dashboard Service
 * @description Aggregates administration overview counts, user/point/card metrics, content health, file statistics, version evidence status, and recent activity.
 * @logic Query independent dashboard metrics concurrently, normalize aggregate values, calculate percentages, and map recent records to the stable API shape.
 * @dependencies Prisma user, content, file, session, and release credential models
 * @index_tags admin,dashboard,metrics,health,recent-activity
 * @author holic512
 */
import 'server-only'

import { prisma } from '@/server/prisma'

export async function getAdminDashboard() {
  const now = new Date()

  const [
    totalUsers,
    activeSessions,
    totalPoints,
    totalGiftCards,
    redeemedGiftCards,
    totalProjects,
    activeProjects,
    totalVersions,
    activeVersions,
    totalCategories,
    activeCategories,
    totalNotes,
    activeNotes,
    totalFiles,
    totalFileSize,
    filesByType,
    totalEvidence,
    finalizedEvidence,
    failedEvidence,
    recentProjects,
    recentNotes,
    recentSessions,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.session.count({ where: { expiresAt: { gte: now }, revokedAt: null } }),
    prisma.user.aggregate({ _sum: { pointsBalance: true } }),
    prisma.giftCard.count(),
    prisma.giftCard.count({ where: { status: 2 } }),
    prisma.project.count({ where: { isDeleted: false } }),
    prisma.project.count({ where: { isDeleted: false, status: 1 } }),
    prisma.projectVersion.count({ where: { isDeleted: false } }),
    prisma.projectVersion.count({
      where: { isDeleted: false, status: 1, publishedAt: { not: null } },
    }),
    prisma.category.count({ where: { isDeleted: false } }),
    prisma.category.count({ where: { isDeleted: false, status: 1 } }),
    prisma.noteInfo.count({ where: { isDeleted: false } }),
    prisma.noteInfo.count({ where: { isDeleted: false, status: 1 } }),
    prisma.fileManagement.count({ where: { status: 1 } }),
    prisma.fileManagement.aggregate({ where: { status: 1 }, _sum: { fileSize: true } }),
    prisma.fileManagement.groupBy({
      by: ['businessType'],
      where: { status: 1 },
      _count: { id: true },
      _sum: { fileSize: true },
    }),
    prisma.releaseCredential.count(),
    prisma.releaseCredential.count({ where: { status: 2 } }),
    prisma.releaseCredential.count({ where: { status: -1 } }),
    prisma.project.findMany({
      where: { isDeleted: false },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        projectName: true,
        status: true,
        createdAt: true,
        _count: { select: { versions: { where: { isDeleted: false } } } },
      },
    }),
    prisma.noteInfo.findMany({
      where: { isDeleted: false },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        id: true,
        noteTitle: true,
        status: true,
        createdAt: true,
        category: {
          select: {
            categoryName: true,
            projectVersion: {
              select: { version: true, project: { select: { projectName: true } } },
            },
          },
        },
      },
    }),
    prisma.session.findMany({
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        ip: true,
        User: { select: { username: true } },
      },
    }),
  ])

  const totalFileSizeBytes = totalFileSize._sum.fileSize || 0n
  const percentage = (active: number, total: number) =>
    total > 0 ? Number(((active / total) * 100).toFixed(1)) : 0

  return {
    overview: {
      users: {
        total: totalUsers,
        activeSessions,
        totalPoints: totalPoints._sum.pointsBalance || 0,
      },
      giftCards: { total: totalGiftCards, redeemed: redeemedGiftCards },
      projects: { total: totalProjects, active: activeProjects },
      versions: { total: totalVersions, active: activeVersions },
      categories: { total: totalCategories, active: activeCategories },
      notes: { total: totalNotes, active: activeNotes },
      files: {
        total: totalFiles,
        totalSizeBytes: totalFileSizeBytes,
        totalSizeMB: (Number(totalFileSizeBytes) / 1024 / 1024).toFixed(2),
        byType: filesByType.map((item) => ({
          type: item.businessType,
          count: item._count.id,
          sizeBytes: item._sum.fileSize || 0n,
        })),
      },
      blockchain: {
        evidence: {
          total: totalEvidence,
          finalized: finalizedEvidence,
          failed: failedEvidence,
          pending: totalEvidence - finalizedEvidence - failedEvidence,
        },
      },
    },
    health: {
      projectUtilization: percentage(activeProjects, totalProjects),
      noteUtilization: percentage(activeNotes, totalNotes),
      categoryUtilization: percentage(activeCategories, totalCategories),
      evidenceFinalizationRate: percentage(finalizedEvidence, totalEvidence),
    },
    recentActivity: {
      projects: recentProjects.map((project) => ({
        id: project.id,
        name: project.projectName,
        status: project.status,
        versionCount: project._count.versions,
        createdAt: project.createdAt,
      })),
      notes: recentNotes.map((note) => ({
        id: note.id,
        title: note.noteTitle,
        status: note.status,
        project: note.category.projectVersion.project.projectName,
        version: note.category.projectVersion.version,
        category: note.category.categoryName,
        createdAt: note.createdAt,
      })),
      sessions: recentSessions.map((session) => ({
        id: session.id,
        username: session.User.username,
        ip: session.ip || '-',
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        isActive: session.expiresAt > now && !session.revokedAt,
        isRevoked: Boolean(session.revokedAt),
      })),
    },
  }
}
