/**
 * @file admin-notes.ts
 * @project SlothVault
 * @module Admin Notes
 * @description Owns note metadata queries and portable serialized NoteContent primary-version mutations for administration APIs.
 * @logic Build provider-portable filters, validate active category/note parents, increment the parent content revision before content writes, and normalize undeleted contents to exactly one primary inside each transaction.
 * @dependencies server/prisma, admin-catalog parsing, Prisma NoteInfo/NoteContent models, server/http/errors
 * @index_tags admin,notes,note-content,service,transaction,revision-lock,primary-version
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import {
  databaseTextContains,
  hasPrismaCode,
  integerValue,
  optionalIntegerValue,
  parseJsonDecimalId,
} from '@/server/services/admin-catalog'

type NoteInfoLike = {
  id: number
  categoryId: number
  noteTitle: string
  weight: number
  status: number
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
  category?:
    | {
        id: number
        categoryName: string
        projectVersionId: number
        projectVersion?:
          | {
              id: number
              version: string
              projectId: number
              project?: { id: number; projectName: string } | null
            }
          | null
      }
    | null
  _count?: { contents: number }
}

type NoteContentLike = {
  id: number
  noteInfoId: number
  content: string
  versionNote: string | null
  isPrimary: boolean
  status: number
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
}

export type CreateNoteContentInput = {
  noteInfoId: number
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

type NoteOrderField =
  | 'id'
  | 'noteTitle'
  | 'weight'
  | 'status'
  | 'createdAt'
  | 'updatedAt'

export type NoteListQuery = {
  page: number
  pageSize: number
  skip: number
  keyword: string
  includeDeleted: boolean
  onlyDeleted: boolean
  status?: number
  categoryId?: number
  projectVersionId?: number
  projectId?: number
  orderByField: NoteOrderField
  order: 'asc' | 'desc'
}

export async function listAdminNotes(query: NoteListQuery) {
  const where: Prisma.NoteInfoWhereInput = {}
  if (query.onlyDeleted) where.isDeleted = true
  else if (!query.includeDeleted) where.isDeleted = false
  if (query.keyword) where.noteTitle = databaseTextContains(query.keyword)
  if (Number.isFinite(query.status)) where.status = query.status
  if (query.categoryId !== undefined) where.categoryId = query.categoryId

  const categoryWhere: Prisma.CategoryWhereInput = {}
  if (query.projectVersionId !== undefined) {
    categoryWhere.projectVersionId = query.projectVersionId
  }
  if (query.projectId !== undefined) {
    categoryWhere.projectVersion = { projectId: query.projectId }
  }
  if (Object.keys(categoryWhere).length > 0) where.category = categoryWhere

  const [total, list] = await Promise.all([
    prisma.noteInfo.count({ where }),
    prisma.noteInfo.findMany({
      where,
      skip: query.skip,
      take: query.pageSize,
      orderBy: { [query.orderByField]: query.order },
      include: {
        category: {
          include: {
            projectVersion: { include: { project: true } },
          },
        },
        _count: { select: { contents: true } },
      },
    }),
  ])

  return {
    list: list.map(noteDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
  }
}

export async function createAdminNote(input: {
  categoryId?: unknown
  noteTitle?: unknown
  weight?: unknown
  status?: unknown
}) {
  const categoryId = parseJsonDecimalId(input.categoryId, 'categoryId')
  const noteTitle = typeof input.noteTitle === 'string' ? input.noteTitle.trim() : ''
  if (!noteTitle) throw new HttpError('Missing noteTitle', 400, 400)

  await requireActiveCategory(categoryId)
  const note = await prisma.noteInfo.create({
    data: {
      categoryId,
      noteTitle,
      weight: integerValue(input.weight, 0),
      status: integerValue(input.status, 1),
    },
    include: { category: true },
  })
  return noteDto(note)
}

export async function getAdminNote(id: number) {
  const note = await prisma.noteInfo.findUnique({
    where: { id },
    include: {
      category: {
        include: { projectVersion: { include: { project: true } } },
      },
      _count: { select: { contents: true } },
    },
  })
  if (!note) throw new HttpError('Not Found', 404, 404)
  return noteDto(note)
}

export async function updateAdminNote(
  id: number,
  input: {
    categoryId?: unknown
    noteTitle?: unknown
    weight?: unknown
    status?: unknown
    isDeleted?: unknown
  },
) {
  const current = await prisma.noteInfo.findFirst({
    where: { id, category: { isDeleted: false } },
    select: { id: true },
  })
  if (!current) throw new HttpError('Not Found', 404, 404)

  const data: Prisma.NoteInfoUncheckedUpdateInput = { updatedAt: new Date() }
  if (input.categoryId !== undefined) {
    const categoryId = parseJsonDecimalId(input.categoryId, 'categoryId')
    await requireActiveCategory(categoryId)
    data.categoryId = categoryId
  }
  if (typeof input.noteTitle === 'string') {
    const noteTitle = input.noteTitle.trim()
    if (!noteTitle) throw new HttpError('Invalid noteTitle', 400, 400)
    data.noteTitle = noteTitle
  }
  const weight = optionalIntegerValue(input.weight)
  if (weight !== null) data.weight = weight
  const status = optionalIntegerValue(input.status)
  if (status !== null) data.status = status
  if (typeof input.isDeleted === 'boolean') data.isDeleted = input.isDeleted
  if (Object.keys(data).length === 1) throw new HttpError('No fields to update', 400, 400)

  try {
    const note = await prisma.noteInfo.update({
      where: { id },
      data,
      include: { category: true },
    })
    return noteDto(note)
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
}

export async function deleteAdminNote(id: number) {
  const current = await prisma.noteInfo.findFirst({
    where: { id, isDeleted: false, category: { isDeleted: false } },
    select: { id: true },
  })
  if (!current) throw new HttpError('Not Found', 404, 404)

  try {
    await prisma.noteInfo.update({
      where: { id },
      data: { isDeleted: true, updatedAt: new Date() },
    })
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
}

export async function requireActiveCategory(categoryId: number) {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, isDeleted: false },
  })
  if (!category) throw new HttpError('Category not found', 404, 404)
  return category
}

export async function requireActiveNoteInfo(noteInfoId: number) {
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

async function lockActiveNoteInfo(tx: Prisma.TransactionClient, noteInfoId: number) {
  const locked = await tx.noteInfo.updateMany({
    where: { id: noteInfoId, isDeleted: false },
    data: {
      contentRevision: { increment: 1 },
      updatedAt: new Date(),
    },
  })
  if (locked.count === 0) {
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
  noteInfoId: number,
  options: { preferredId?: number; forceLatest?: boolean } = {},
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

export async function updateNoteContent(id: number, input: UpdateNoteContentInput) {
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

export async function deleteNoteContent(id: number) {
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

export async function listAdminNoteContents(noteInfoId: number, includeDeleted: boolean) {
  await requireActiveNoteInfo(noteInfoId)
  const where: Prisma.NoteContentWhereInput = { noteInfoId }
  if (!includeDeleted) where.isDeleted = false
  const list = await prisma.noteContent.findMany({
    where,
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
  })
  return { list: list.map(noteContentDto) }
}

export async function createAdminNoteContent(input: {
  noteInfoId?: unknown
  content?: unknown
  versionNote?: unknown
  isPrimary?: unknown
  status?: unknown
}) {
  const item = await createNoteContent({
    noteInfoId: parseJsonDecimalId(input.noteInfoId, 'noteInfoId'),
    content: typeof input.content === 'string' ? input.content : '',
    versionNote:
      typeof input.versionNote === 'string' ? input.versionNote.trim() || null : null,
    isPrimary: input.isPrimary === true,
    status: integerValue(input.status, 1),
  })
  return noteContentDto(item)
}

export async function updateAdminNoteContent(
  id: number,
  input: {
    content?: unknown
    versionNote?: unknown
    isPrimary?: unknown
    status?: unknown
    isDeleted?: unknown
  },
) {
  const update: UpdateNoteContentInput = {}
  if (typeof input.content === 'string') update.content = input.content
  if (input.versionNote !== undefined) {
    update.versionNote =
      typeof input.versionNote === 'string' ? input.versionNote.trim() || null : null
  }
  const status = optionalIntegerValue(input.status)
  if (status !== null) update.status = status
  if (typeof input.isDeleted === 'boolean') update.isDeleted = input.isDeleted
  if (input.isPrimary === true) update.isPrimary = true
  if (Object.keys(update).length === 0) {
    throw new HttpError('No fields to update', 400, 400)
  }

  return noteContentDto(await updateNoteContent(id, update))
}

export async function deleteAdminNoteContent(id: number) {
  await deleteNoteContent(id)
}
