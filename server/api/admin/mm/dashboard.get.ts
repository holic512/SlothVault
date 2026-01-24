import { defineEventHandler } from 'h3'
import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'

/**
 * 管理后台仪表盘数据接口
 * 返回系统各模块的统计数据
 */
export default defineEventHandler(async (event) => {
  try {
    // 并行获取所有统计数据
    const [
      // 用户与会话统计
      totalUsers,
      activeSessions,
      expiredSessions,

      // 项目统计
      totalProjects,
      activeProjects,
      projectsWithAuth,

      // 版本统计
      totalVersions,
      activeVersions,

      // 分类统计
      totalCategories,
      activeCategories,

      // 笔记统计
      totalNotes,
      activeNotes,
      notesWithMultipleVersions,

      // 笔记内容统计
      totalNoteContents,
      primaryContents,

      // 文件统计
      totalFiles,
      activeFiles,
      totalFileSize,
      filesByType,

      // Solana cNFT 统计
      totalMerkleTrees,
      activeMerkleTrees,
      fullMerkleTrees,
      totalCNFTs,
      mintedCNFTs,
      failedCNFTs,

      // 最近创建的项目
      recentProjects,

      // 最近创建的笔记
      recentNotes,

      // 最近上传的文件
      recentFiles,

      // 最近的会话活动
      recentSessions,
    ] = await Promise.all([
      // === 用户与会话统计 ===
      prisma.user.count(),
      prisma.session.count({
        where: {
          expiresAt: { gte: new Date() },
          revokedAt: null,
        },
      }),
      prisma.session.count({
        where: {
          expiresAt: { lt: new Date() },
        },
      }),

      // === 项目统计 ===
      prisma.project.count({
        where: { isDeleted: false },
      }),
      prisma.project.count({
        where: { isDeleted: false, status: 1 },
      }),
      prisma.project.count({
        where: { isDeleted: false, requireAuth: true },
      }),

      // === 版本统计 ===
      prisma.projectVersion.count({
        where: { isDeleted: false },
      }),
      prisma.projectVersion.count({
        where: { isDeleted: false, status: 1 },
      }),

      // === 分类统计 ===
      prisma.category.count({
        where: { isDeleted: false },
      }),
      prisma.category.count({
        where: { isDeleted: false, status: 1 },
      }),

      // === 笔记统计 ===
      prisma.noteInfo.count({
        where: { isDeleted: false },
      }),
      prisma.noteInfo.count({
        where: { isDeleted: false, status: 1 },
      }),
      // 有多个版本的笔记数量 - 使用 Prisma 聚合代替原始查询
      prisma.noteContent.groupBy({
        by: ['noteInfoId'],
        where: { isDeleted: false },
        _count: { id: true },
      }).then(result => result.filter(item => item._count.id > 1).length),

      // === 笔记内容统计 ===
      prisma.noteContent.count({
        where: { isDeleted: false },
      }),
      prisma.noteContent.count({
        where: { isDeleted: false, isPrimary: true },
      }),

      // === 文件统计 ===
      prisma.fileManagement.count({
        where: { status: 1 },
      }),
      prisma.fileManagement.count({
        where: { status: 1 },
      }),
      // 总文件大小
      prisma.fileManagement.aggregate({
        where: { status: 1 },
        _sum: { fileSize: true },
      }).then(result => result._sum.fileSize || BigInt(0)),
      // 按业务类型分组统计
      prisma.fileManagement.groupBy({
        by: ['businessType'],
        where: { status: 1 },
        _count: { id: true },
        _sum: { fileSize: true },
      }),

      // === Solana cNFT 统计 ===
      prisma.merkleTree.count({
        where: { isDeleted: false },
      }),
      prisma.merkleTree.count({
        where: { isDeleted: false, status: 1 },
      }),
      prisma.merkleTree.count({
        where: { isDeleted: false, status: 2 },
      }),
      prisma.compressedNft.count(),
      prisma.compressedNft.count({
        where: { status: 1 },
      }),
      prisma.compressedNft.count({
        where: { status: -1 },
      }),

      // === 最近创建的项目（前5个）===
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
          _count: {
            select: {
              versions: { where: { isDeleted: false } },
            },
          },
        },
      }),

      // === 最近创建的笔记（前10个）===
      prisma.noteInfo.findMany({
        where: { isDeleted: false },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          noteTitle: true,
          status: true,
          createdAt: true,
          category: {
            select: {
              categoryName: true,
              projectVersion: {
                select: {
                  version: true,
                  project: {
                    select: {
                      projectName: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),

      // === 最近上传的文件（前10个）===
      prisma.fileManagement.findMany({
        where: { status: 1 },
        orderBy: { createTime: 'desc' },
        take: 10,
        select: {
          id: true,
          originalName: true,
          fileName: true,
          fileSize: true,
          businessType: true,
          createTime: true,
        },
      }),

      // === 最近的会话活动（前10个）===
      prisma.session.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          revokedAt: true,
          ip: true,
          User: {
            select: {
              username: true,
            },
          },
        },
      }),
    ])

    // 计算文件大小（转换为 MB）
    const totalFileSizeMB = Number(totalFileSize) / (1024 * 1024)

    // 构建响应数据
    const dashboardData = {
      // 概览统计
      overview: {
        users: {
          total: totalUsers,
          activeSessions,
          expiredSessions,
        },
        projects: {
          total: totalProjects,
          active: activeProjects,
          withAuth: projectsWithAuth,
          inactive: totalProjects - activeProjects,
        },
        versions: {
          total: totalVersions,
          active: activeVersions,
          inactive: totalVersions - activeVersions,
        },
        categories: {
          total: totalCategories,
          active: activeCategories,
          inactive: totalCategories - activeCategories,
        },
        notes: {
          total: totalNotes,
          active: activeNotes,
          inactive: totalNotes - activeNotes,
          withMultipleVersions: notesWithMultipleVersions,
        },
        noteContents: {
          total: totalNoteContents,
          primary: primaryContents,
          secondary: totalNoteContents - primaryContents,
        },
        files: {
          total: totalFiles,
          active: activeFiles,
          totalSizeBytes: totalFileSize.toString(),
          totalSizeMB: totalFileSizeMB.toFixed(2),
          byType: filesByType.map(item => ({
            type: item.businessType,
            count: item._count.id,
            sizeBytes: item._sum.fileSize?.toString() || '0',
            sizeMB: (Number(item._sum.fileSize || 0) / (1024 * 1024)).toFixed(2),
          })),
        },
        blockchain: {
          merkleTrees: {
            total: totalMerkleTrees,
            active: activeMerkleTrees,
            full: fullMerkleTrees,
          },
          cnfts: {
            total: totalCNFTs,
            minted: mintedCNFTs,
            failed: failedCNFTs,
            pending: totalCNFTs - mintedCNFTs - failedCNFTs,
          },
        },
      },

      // 最近活动
      recentActivity: {
        projects: recentProjects.map(p => ({
          id: p.id.toString(),
          name: p.projectName,
          status: p.status,
          requireAuth: p.requireAuth,
          versionCount: p._count.versions,
          createdAt: p.createdAt,
        })),
        notes: recentNotes.map(n => ({
          id: n.id.toString(),
          title: n.noteTitle,
          status: n.status,
          project: n.category?.projectVersion?.project?.projectName || '-',
          version: n.category?.projectVersion?.version || '-',
          category: n.category?.categoryName || '-',
          createdAt: n.createdAt,
        })),
        files: recentFiles.map(f => ({
          id: f.id.toString(),
          originalName: f.originalName,
          fileName: f.fileName,
          sizeBytes: f.fileSize.toString(),
          sizeMB: (Number(f.fileSize) / (1024 * 1024)).toFixed(2),
          businessType: f.businessType,
          createdAt: f.createTime,
        })),
        sessions: recentSessions.map(s => ({
          id: s.id,
          username: s.User.username,
          ip: s.ip || '-',
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          isActive: s.expiresAt > new Date() && !s.revokedAt,
          isRevoked: !!s.revokedAt,
        })),
      },

      // 系统健康度指标
      health: {
        projectUtilization: totalProjects > 0 ? ((activeProjects / totalProjects) * 100).toFixed(1) : '0',
        noteUtilization: totalNotes > 0 ? ((activeNotes / totalNotes) * 100).toFixed(1) : '0',
        categoryUtilization: totalCategories > 0 ? ((activeCategories / totalCategories) * 100).toFixed(1) : '0',
        cnftSuccessRate: totalCNFTs > 0 ? ((mintedCNFTs / totalCNFTs) * 100).toFixed(1) : '0',
        merkleTreeUtilization: totalMerkleTrees > 0 ? ((activeMerkleTrees / totalMerkleTrees) * 100).toFixed(1) : '0',
      },
    }

    return ok(dashboardData)
  } catch (error: any) {
    console.error('Dashboard API error:', error)
    return fail(error?.message || 'Failed to fetch dashboard data', 500)
  }
})
