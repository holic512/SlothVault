/**
 * @file public-users.ts
 * @project SlothVault
 * @module Public Personal Profiles
 * @description Resolves shareable user profiles and administrator-authored published articles with optional copyright certificate summaries.
 * @logic Expose only active profile fields, require each listed article to be published through an active collection/version/category, and join cNFT records as copyright evidence rather than access credentials.
 * @dependencies Prisma User/NoteInfo/CompressedNft models
 * @index_tags user,profile,public,articles,copyright
 * @author holic512
 */
import 'server-only'

import { cache } from 'react'

import { prisma } from '@/server/prisma'

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
      contents: { some: { status: 1, isDeleted: false } },
      category: {
        status: 1,
        isDeleted: false,
        projectVersion: {
          status: 1,
          isDeleted: false,
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
              project: { select: { id: true, projectName: true } },
            },
          },
        },
      },
    },
  })
  const noteIds = notes.map((note) => note.id)
  const certificates = noteIds.length
    ? await prisma.compressedNft.findMany({
        where: {
          noteInfoId: { in: noteIds },
          copyrightOwnerId: user.id,
          status: 1,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          noteInfoId: true,
          assetId: true,
          mintTxSignature: true,
          metadataUri: true,
        },
      })
    : []
  const certificateMap = new Map(
    certificates
      .filter((item) => item.noteInfoId !== null)
      .map((item) => [item.noteInfoId!, item]),
  )

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
      const certificate = certificateMap.get(note.id)
      return {
        id: note.id.toString(),
        title: note.noteTitle,
        category: note.category.categoryName,
        project: version.project.projectName,
        version: version.version,
        updatedAt: note.updatedAt,
        href: `/project/${version.project.id}/v/${version.id}/docs/${note.id}`,
        certificate: certificate
          ? {
              assetId: certificate.assetId,
              transaction: certificate.mintTxSignature,
              metadataUri: certificate.metadataUri,
            }
          : null,
      }
    }),
  }
})
