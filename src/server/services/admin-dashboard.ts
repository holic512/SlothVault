/**
 * @file admin-dashboard.ts
 * @project SlothVault
 * @module Admin Dashboard Service
 * @description Aggregates portable administration overview, UTC activity trends, health, distributions, and privacy-safe recent activity.
 * @logic Query live metrics and time-window records concurrently, aggregate calendar-day series without provider-specific SQL, mask session IPs before output, and expose stable dashboard-ready summaries.
 * @dependencies Prisma user, content, file, session, and release credential models
 * @index_tags admin,dashboard,metrics,trends,health,recent-activity,privacy
 * @author holic512
 */
import 'server-only'

import { prisma } from '@/server/prisma'

export const ADMIN_DASHBOARD_RANGES = [7, 30, 90] as const

export type AdminDashboardRange = (typeof ADMIN_DASHBOARD_RANGES)[number]

export function isAdminDashboardRange(value: number): value is AdminDashboardRange {
  return ADMIN_DASHBOARD_RANGES.includes(value as AdminDashboardRange)
}

type DashboardOptions = {
  range?: AdminDashboardRange
  now?: Date
}

type TrendPoint = {
  date: string
  users: number
  projects: number
  articles: number
  notes: number
}

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function isoDay(value: Date) {
  return value.toISOString().slice(0, 10)
}

function createTrend(range: AdminDashboardRange, now: Date): {
  start: Date
  end: Date
  points: TrendPoint[]
} {
  const today = startOfUtcDay(now)
  const start = new Date(today.getTime() - (range - 1) * DAY_IN_MILLISECONDS)
  const end = new Date(today.getTime() + DAY_IN_MILLISECONDS)
  const points = Array.from({ length: range }, (_, index) => ({
    date: isoDay(new Date(start.getTime() + index * DAY_IN_MILLISECONDS)),
    users: 0,
    projects: 0,
    articles: 0,
    notes: 0,
  }))

  return { start, end, points }
}

function incrementTrend(
  points: TrendPoint[],
  indexByDate: Map<string, number>,
  field: Exclude<keyof TrendPoint, 'date'>,
  value: Date | null,
) {
  if (!value) return
  const index = indexByDate.get(isoDay(value))
  if (index !== undefined) points[index][field] += 1
}

export function maskDashboardIp(ip: string | null) {
  if (!ip || ip === '-') return '-'

  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean)
    if (parts.length === 0) return '••••'
    return `${parts.slice(0, 2).join(':')}::••••`
  }

  const parts = ip.split('.')
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.•••.•••` : '••••'
}

export async function getAdminDashboard({
  range = 30,
  now = new Date(),
}: DashboardOptions = {}) {
  const { start, end, points: trend } = createTrend(range, now)
  const trendIndex = new Map(trend.map((point, index) => [point.date, index]))

  const [
    totalUsers,
    activeSessions,
    totalPoints,
    totalGiftCards,
    redeemedGiftCards,
    totalArticles,
    publishedArticles,
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
    recentArticles,
    recentNotes,
    recentSessions,
    trendUsers,
    trendProjects,
    trendArticles,
    trendNotes,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.session.count({ where: { expiresAt: { gte: now }, revokedAt: null } }),
    prisma.user.aggregate({ _sum: { pointsBalance: true } }),
    prisma.giftCard.count(),
    prisma.giftCard.count({ where: { status: 2 } }),
    prisma.article.count({ where: { isDeleted: false } }),
    prisma.article.count({ where: { isDeleted: false, status: 1, publishedAt: { not: null } } }),
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
    prisma.article.findMany({
      where: { isDeleted: false },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        title: true,
        status: true,
        publishedAt: true,
        updatedAt: true,
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
              select: {
                version: true,
                project: { select: { id: true, projectName: true } },
              },
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
    prisma.user.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { createdAt: true },
    }),
    prisma.project.findMany({
      where: { isDeleted: false, createdAt: { gte: start, lt: end } },
      select: { createdAt: true },
    }),
    prisma.article.findMany({
      where: { isDeleted: false, status: 1, publishedAt: { gte: start, lt: end } },
      select: { publishedAt: true },
    }),
    prisma.noteInfo.findMany({
      where: { isDeleted: false, createdAt: { gte: start, lt: end } },
      select: { createdAt: true },
    }),
  ])

  for (const item of trendUsers) incrementTrend(trend, trendIndex, 'users', item.createdAt)
  for (const item of trendProjects) incrementTrend(trend, trendIndex, 'projects', item.createdAt)
  for (const item of trendArticles) incrementTrend(trend, trendIndex, 'articles', item.publishedAt)
  for (const item of trendNotes) incrementTrend(trend, trendIndex, 'notes', item.createdAt)

  const totalFileSizeBytes = totalFileSize._sum.fileSize || 0n
  const percentage = (active: number, total: number) =>
    total > 0 ? Number(((active / total) * 100).toFixed(1)) : 0
  const evidencePending = totalEvidence - finalizedEvidence - failedEvidence

  const projects = recentProjects.map((project) => ({
    id: project.id,
    name: project.projectName,
    status: project.status,
    versionCount: project._count.versions,
    createdAt: project.createdAt,
  }))
  const articles = recentArticles.map((article) => ({
    id: article.id,
    title: article.title,
    status: article.status,
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
  }))
  const notes = recentNotes.map((note) => ({
    id: note.id,
    title: note.noteTitle,
    status: note.status,
    projectId: note.category.projectVersion.project.id,
    project: note.category.projectVersion.project.projectName,
    version: note.category.projectVersion.version,
    category: note.category.categoryName,
    createdAt: note.createdAt,
  }))
  const sessions = recentSessions.map((session) => ({
    id: session.id,
    username: session.User.username,
    maskedIp: maskDashboardIp(session.ip),
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    isActive: session.expiresAt > now && !session.revokedAt,
    isRevoked: Boolean(session.revokedAt),
  }))

  const feed = [
    ...projects.map((project) => ({
      id: `project-${project.id}`,
      type: 'project' as const,
      title: project.name,
      timestamp: project.createdAt,
      href: '/admin/mm/projects',
    })),
    ...articles.map((article) => ({
      id: `article-${article.id}`,
      type: 'article' as const,
      title: article.title,
      timestamp: article.updatedAt,
      href: `/admin/mm/articles/${article.id}`,
    })),
    ...notes.map((note) => ({
      id: `note-${note.id}`,
      type: 'note' as const,
      title: note.title,
      detail: `${note.project} · ${note.version} · ${note.category}`,
      timestamp: note.createdAt,
      href: `/admin/mm/notes?projectId=${note.projectId}`,
    })),
    ...sessions.map((session) => ({
      id: `session-${session.id}`,
      type: 'session' as const,
      title: session.username,
      detail: session.maskedIp,
      timestamp: session.createdAt,
      href: '/admin/mm/users',
      status: session.isRevoked ? 'revoked' : session.isActive ? 'active' : 'expired',
    })),
  ]
    .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime())
    .slice(0, 8)

  return {
    range: {
      days: range,
      start: isoDay(start),
      end: isoDay(new Date(end.getTime() - DAY_IN_MILLISECONDS)),
      generatedAt: now,
    },
    overview: {
      users: {
        total: totalUsers,
        activeSessions,
        totalPoints: totalPoints._sum.pointsBalance || 0,
      },
      giftCards: { total: totalGiftCards, redeemed: redeemedGiftCards },
      articles: { total: totalArticles, published: publishedArticles },
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
          pending: evidencePending,
        },
      },
    },
    periodTotals: trend.reduce(
      (totals, point) => ({
        users: totals.users + point.users,
        projects: totals.projects + point.projects,
        articles: totals.articles + point.articles,
        notes: totals.notes + point.notes,
      }),
      { users: 0, projects: 0, articles: 0, notes: 0 },
    ),
    trend,
    health: {
      projectUtilization: percentage(activeProjects, totalProjects),
      articlePublicationRate: percentage(publishedArticles, totalArticles),
      noteUtilization: percentage(activeNotes, totalNotes),
      categoryUtilization: percentage(activeCategories, totalCategories),
      evidenceFinalizationRate: percentage(finalizedEvidence, totalEvidence),
    },
    recentActivity: { projects, articles, notes, sessions, feed },
  }
}
