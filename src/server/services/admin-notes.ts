/**
 * @file admin-notes.ts
 * @project SlothVault
 * @module Admin Notes
 * @description Provides note DTO mapping, active-parent validation, and serialized NoteContent primary-version mutations.
 * @logic Lock the parent docs.NoteInfo row before every content write, mutate inside one transaction, then normalize undeleted contents to exactly one primary when any remain.
 * @dependencies Prisma NoteInfo/NoteContent models, PostgreSQL row locks, server/http/errors
 * @index_tags admin,notes,note-content,transaction,row-lock,primary-version
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma/client'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'

type NoteInfoLike = {
  id: bigint
  categoryId: bigint
  noteTitle: string
  weight: number
  status: number
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
  category?:
    | {
        id: bigint
        categoryName: string
        projectVersionId: bigint
        projectVersion?:
          | {
              id: bigint
              version: string
              projectId: bigint
              project?: { id: bigint; projectName: string } | null
            }
          | null
      }
    | null
  _count?: { contents: number }
}

type NoteContentLike = {
  id: bigint
  noteInfoId: bigint
  content: string
  versionNote: string | null
  isPrimary: boolean
  status: number
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
}

export type CreateNoteContentInput = {
  noteInfoId: bigint
  content: string
  versionNote: string | null
  isPrimary: boolean
  status: number
}

export type UpdateNoteContentInput = {
  content?: string
  versionNote?: string | null
  isPrimary?: boolean
  status?: number
  isDeleted?: boolean
}

export function noteDto(note: NoteInfoLike) {
  const category = note.category
  return {
    id: note.id.toString(),
    categoryId: note.categoryId.toString(),
    noteTitle: note.noteTitle,
    weight: note.weight,
    status: note.status,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    isDeleted: note.isDeleted,
    category: category
      ? {
          id: category.id.toString(),
          categoryName: category.categoryName,
          projectVersionId: category.projectVersionId.toString(),
          ...(category.projectVersion !== undefined
            ? {
                projectVersion: category.projectVersion
                  ? {
                      id: category.projectVersion.id.toString(),
                      version: category.projectVersion.version,
                      projectId: category.projectVersion.projectId.toString(),
                      ...(category.projectVersion.project !== undefined
                        ? {
                            project: category.projectVersion.project
                              ? {
                                  id: category.projectVersion.project.id.toString(),
                                  projectName: category.projectVersion.project.projectName,
                                }
                              : null,
                          }
                        : {}),
                    }
                  : null,
              }
            : {}),
        }
      : null,
    ...(note._count !== undefined ? { contentCount: note._count.contents } : {}),
  }
}

export function noteContentDto(item: NoteContentLike) {
  return {
    id: item.id.toString(),
    noteInfoId: item.noteInfoId.toString(),
    content: item.content,
    versionNote: item.versionNote,
    isPrimary: item.isPrimary,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    isDeleted: item.isDeleted,
  }
}

export async function requireActiveCategory(categoryId: bigint) {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, isDeleted: false },
  })
  if (!category) throw new HttpError('Category not found', 404, 404)
  return category
}

export async function requireActiveNoteInfo(noteInfoId: bigint) {
  const noteInfo = await prisma.noteInfo.findFirst({
    where: {
      id: noteInfoId,
      isDeleted: false,
      category: { isDeleted: false },
    },
  })
  if (!noteInfo) throw new HttpError('NoteInfo not found', 404, 404)
  return noteInfo
}

async function lockActiveNoteInfo(tx: Prisma.TransactionClient, noteInfoId: bigint) {
  const lockedRows = await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT "id"
    FROM docs."NoteInfo"
    WHERE "id" = ${noteInfoId}
    FOR UPDATE
  `

  if (lockedRows.length === 0) {
    throw new HttpError('NoteInfo not found', 404, 404)
  }

  const noteInfo = await tx.noteInfo.findFirst({
    where: {
      id: noteInfoId,
      isDeleted: false,
      category: { isDeleted: false },
    },
    select: { id: true },
  })
  if (!noteInfo) throw new HttpError('NoteInfo not found', 404, 404)
}

async function normalizePrimaryContent(
  tx: Prisma.TransactionClient,
  noteInfoId: bigint,
  options: { preferredId?: bigint; forceLatest?: boolean } = {},
) {
  const activeContents = await tx.noteContent.findMany({
    where: { noteInfoId, isDeleted: false },
    select: {
      id: true,
      isPrimary: true,
      updatedAt: true,
      createdAt: true,
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  })

  if (activeContents.length === 0) {
    await tx.noteContent.updateMany({
      where: { noteInfoId, isPrimary: true },
      data: { isPrimary: false, updatedAt: new Date() },
    })
    return
  }

  const preferred = options.preferredId
    ? activeContents.find((item) => item.id === options.preferredId)
    : undefined
  const existingPrimary = activeContents.find((item) => item.isPrimary)
  const selected = preferred ?? (options.forceLatest ? activeContents[0] : existingPrimary) ?? activeContents[0]
  const now = new Date()

  await tx.noteContent.updateMany({
    where: {
      noteInfoId,
      isPrimary: true,
      id: { not: selected.id },
    },
    data: { isPrimary: false, updatedAt: now },
  })

  if (!selected.isPrimary) {
    await tx.noteContent.update({
      where: { id: selected.id },
      data: { isPrimary: true, updatedAt: now },
    })
  }
}

export async function createNoteContent(input: CreateNoteContentInput) {
  return prisma.$transaction(async (tx) => {
    await lockActiveNoteInfo(tx, input.noteInfoId)

    const created = await tx.noteContent.create({
      data: {
        noteInfoId: input.noteInfoId,
        content: input.content,
        versionNote: input.versionNote,
        isPrimary: false,
        status: input.status,
      },
    })

    await normalizePrimaryContent(
      tx,
      input.noteInfoId,
      { preferredId: input.isPrimary ? created.id : undefined },
    )

    return tx.noteContent.findUniqueOrThrow({ where: { id: created.id } })
  })
}

export async function updateNoteContent(id: bigint, input: UpdateNoteContentInput) {
  const reference = await prisma.noteContent.findUnique({
    where: { id },
    select: { noteInfoId: true },
  })
  if (!reference) throw new HttpError('Not Found', 404, 404)

  return prisma.$transaction(async (tx) => {
    await lockActiveNoteInfo(tx, reference.noteInfoId)

    const current = await tx.noteContent.findUnique({ where: { id } })
    if (!current) throw new HttpError('Not Found', 404, 404)
    if (current.noteInfoId !== reference.noteInfoId) {
      throw new HttpError('NoteContent parent changed during update', 409, 409)
    }

    const resultingDeleted = input.isDeleted ?? current.isDeleted
    if (input.isPrimary === true && resultingDeleted) {
      throw new HttpError('Deleted content cannot be primary', 400, 400)
    }

    const data: Prisma.NoteContentUpdateInput = { updatedAt: new Date() }
    if (input.content !== undefined) data.content = input.content
    if (input.versionNote !== undefined) data.versionNote = input.versionNote
    if (input.status !== undefined) data.status = input.status
    if (input.isDeleted !== undefined) data.isDeleted = input.isDeleted
    if (resultingDeleted) data.isPrimary = false

    await tx.noteContent.update({ where: { id }, data })
    await normalizePrimaryContent(
      tx,
      current.noteInfoId,
      {
        preferredId: input.isPrimary === true ? current.id : undefined,
        forceLatest: current.isPrimary && resultingDeleted,
      },
    )

    return tx.noteContent.findUniqueOrThrow({ where: { id } })
  })
}

export async function deleteNoteContent(id: bigint) {
  const reference = await prisma.noteContent.findUnique({
    where: { id },
    select: { noteInfoId: true },
  })
  if (!reference) throw new HttpError('Not Found', 404, 404)

  await prisma.$transaction(async (tx) => {
    await lockActiveNoteInfo(tx, reference.noteInfoId)

    const current = await tx.noteContent.findUnique({ where: { id } })
    if (!current) throw new HttpError('Not Found', 404, 404)
    if (current.noteInfoId !== reference.noteInfoId) {
      throw new HttpError('NoteContent parent changed during delete', 409, 409)
    }

    await tx.noteContent.update({
      where: { id },
      data: { isDeleted: true, isPrimary: false, updatedAt: new Date() },
    })
    await normalizePrimaryContent(tx, current.noteInfoId, {
      forceLatest: current.isPrimary,
    })
  })
}
