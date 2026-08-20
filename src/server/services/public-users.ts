/**
 * @file public-users.ts
 * @project SlothVault
 * @module Public Personal Profiles
 * @description Resolves shareable user profiles and administrator-authored published articles with version evidence markers.
 * @logic Expose active profile fields, require a visible immutable release, and mark articles when their shared version has finalized transaction evidence.
 * @dependencies Prisma User, NoteInfo, ProjectVersion, ReleaseCredential models
 * @index_tags user,profile,public,articles,evidence
 * @author holic512
 */
import 'server-only'

import { cache } from 'react'

import { prisma } from '@/server/prisma'
import { RELEASE_MANIFEST_VERSION } from '@/server/services/project-version-release'

export const getPublicUserProfile = cache(async (username: string) => {
  const user = await prisma.user.findFirst({
    where: { username: username.trim().toLowerCase(), status: 1 },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatar: true,
      bio: true,
      role: true,
      createdAt: true,
    },
  })
  if (!user) return null

  const notes = await prisma.noteInfo.findMany({
    where: {
      authorId: user.id,
      status: 1,
      isDeleted: false,
      contents: { some: { status: 1, isDeleted: false, isPrimary: true } },
      category: {
        status: 1,
        isDeleted: false,
        projectVersion: {
          status: 1,
          isDeleted: false,
          publishedAt: { not: null },
          releaseId: { not: null },
          releaseHash: { not: null },
          manifestVersion: RELEASE_MANIFEST_VERSION,
          project: { status: 1, isDeleted: false },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      noteTitle: true,
      updatedAt: true,
      category: {
        select: {
          categoryName: true,
          projectVersion: {
            select: {
              id: true,
              version: true,
              releaseId: true,
              releaseHash: true,
              manifestVersion: true,
              publishedAt: true,
              releaseCredentials: {
                where: { status: 2, subjectType: 'PROJECT_VERSION' },
                select: { id: true },
                take: 1,
              },
              project: { select: { id: true, projectName: true } },
            },
          },
        },
      },
    },
  })
  return {
    user: {
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      bio: user.bio,
      role: user.role,
      createdAt: user.createdAt,
    },
    articles: notes.map((note) => {
      const version = note.category.projectVersion
      return {
        id: note.id.toString(),
        title: note.noteTitle,
        category: note.category.categoryName,
        project: version.project.projectName,
        version: version.version,
        releaseId: version.releaseId!,
        releaseHash: version.releaseHash!,
        manifestVersion: version.manifestVersion!,
        publishedAt: version.publishedAt!,
        updatedAt: note.updatedAt,
        href: `/project/${version.project.id}/v/${version.id}/docs/${note.id}`,
        hasEvidence: version.releaseCredentials.length > 0,
      }
    }),
  }
})
