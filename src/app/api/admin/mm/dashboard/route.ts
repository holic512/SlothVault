import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  const now = new Date()

  const [
    totalUsers,
    activeSessions,
    totalProjects,
    activeProjects,
    projectsWithAuth,
    totalVersions,
    activeVersions,
    totalCategories,
    activeCategories,
    totalNotes,
    activeNotes,
    totalFiles,
    totalFileSize,
    filesByType,
    totalMerkleTrees,
    activeMerkleTrees,
    totalCnfts,
    mintedCnfts,
    failedCnfts,
    recentProjects,
    recentNotes,
    recentSessions,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.session.count({ where: { expiresAt: { gte: now }, revokedAt: null } }),
    prisma.project.count({ where: { isDeleted: false } }),
    prisma.project.count({ where: { isDeleted: false, status: 1 } }),
    prisma.project.count({ where: { isDeleted: false, requireAuth: true } }),
    prisma.projectVersion.count({ where: { isDeleted: false } }),
    prisma.projectVersion.count({ where: { isDeleted: false, status: 1 } }),
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
    prisma.merkleTree.count({ where: { isDeleted: false } }),
    prisma.merkleTree.count({ where: { isDeleted: false, status: 1 } }),
    prisma.compressedNft.count(),
    prisma.compressedNft.count({ where: { status: 1 } }),
    prisma.compressedNft.count({ where: { status: -1 } }),
    prisma.project.findMany({
      where: { isDeleted: false },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        projectName: true,
        status: true,
        requireAuth: true,
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

  return apiOk({
    overview: {
      users: { total: totalUsers, activeSessions },
      projects: { total: totalProjects, active: activeProjects, withAuth: projectsWithAuth },
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
        merkleTrees: { total: totalMerkleTrees, active: activeMerkleTrees },
        cnfts: {
          total: totalCnfts,
          minted: mintedCnfts,
          failed: failedCnfts,
          pending: totalCnfts - mintedCnfts - failedCnfts,
        },
      },
    },
    health: {
      projectUtilization: percentage(activeProjects, totalProjects),
      noteUtilization: percentage(activeNotes, totalNotes),
      categoryUtilization: percentage(activeCategories, totalCategories),
      cnftSuccessRate: percentage(mintedCnfts, totalCnfts),
      merkleTreeUtilization: percentage(activeMerkleTrees, totalMerkleTrees),
    },
    recentActivity: {
      projects: recentProjects.map((project) => ({
        id: project.id,
        name: project.projectName,
        status: project.status,
        requireAuth: project.requireAuth,
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
  })
})
