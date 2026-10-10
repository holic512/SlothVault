/**
 * @file admin-note-tags.ts
 * @project SlothVault
 * @module Administrator Note Tags
 * @description Reads one note's tags and performs atomic, draft-only single-tag additions, removals and renames.
 * @logic Validate tag names, lock the owning draft before reading current tags, recheck parent identity, preserve unrelated tags and invalidate public metadata after changed writes.
 * @dependencies server/prisma, lib/note-tags, project-version release locks, public-project-cache
 * @index_tags notes,tags,mcp,transaction,draft
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'
import { noteTagSchema, noteTagsSchema, readNoteTags } from '@/lib/note-tags'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { executeVersionWrite, lockDraftProjectVersions } from './project-version-release'
import { invalidatePublicProjectCache } from './public-project-cache'

const activeNoteWhere: Prisma.NoteInfoWhereInput = {
  isDeleted: false,
  category: { isDeleted: false, projectVersion: { isDeleted: false, project: { isDeleted: false } } },
}

function tagValue(value: unknown) {
  const result = noteTagSchema.safeParse(value)
  if (!result.success) throw new HttpError('Invalid tag: use a nonempty string of at most 30 characters', 400, 400)
  return result.data
}

export async function listAdminNoteTags(noteId: number) {
  const note = await prisma.noteInfo.findFirst({
    where: { ...activeNoteWhere, id: noteId },
    select: { tagsJson: true },
  })
  if (!note) throw new HttpError('Note not found', 404, 404)
  return { noteId: String(noteId), tags: readNoteTags(note.tagsJson) }
}

async function mutateNoteTags(noteId: number, change: (tags: string[]) => string[]) {
  const result = await executeVersionWrite(async (tx) => {
    const parent = await tx.noteInfo.findFirst({
      where: { ...activeNoteWhere, id: noteId },
      select: { category: { select: { projectVersionId: true } } },
    })
    if (!parent) throw new HttpError('Note not found', 404, 404)
    const versionId = parent.category.projectVersionId
    await lockDraftProjectVersions(tx, [versionId])
    const note = await tx.noteInfo.findFirst({
      where: { ...activeNoteWhere, id: noteId },
      select: { tagsJson: true, category: { select: { projectVersionId: true } } },
    })
    if (!note || note.category.projectVersionId !== versionId) {
      throw new HttpError('Note parent changed during tag update', 409, 409, { reason: 'VERSION_WRITE_CONFLICT' })
    }
    const current = readNoteTags(note.tagsJson)
    const parsed = noteTagsSchema.safeParse(change(current))
    if (!parsed.success) throw new HttpError('A note can have at most 10 tags', 400, 400)
    const tags = parsed.data
    const changed = JSON.stringify(tags) !== JSON.stringify(current)
    if (changed) await tx.noteInfo.update({ where: { id: noteId }, data: { tagsJson: JSON.stringify(tags), updatedAt: new Date() } })
    return { noteId: String(noteId), tags, changed }
  })
  if (result.changed) await invalidatePublicProjectCache()
  return { noteId: result.noteId, tags: result.tags }
}

export async function addAdminNoteTag(noteId: number, value: unknown) {
  const tag = tagValue(value)
  return mutateNoteTags(noteId, (tags) => tags.includes(tag) ? tags : [...tags, tag])
}

export async function removeAdminNoteTag(noteId: number, value: unknown) {
  const tag = tagValue(value)
  return mutateNoteTags(noteId, (tags) => tags.filter((item) => item !== tag))
}

export async function renameAdminNoteTag(noteId: number, value: unknown, replacement: unknown) {
  const tag = tagValue(value)
  const newTag = tagValue(replacement)
  return mutateNoteTags(noteId, (tags) => {
    if (!tags.includes(tag)) throw new HttpError('Note tag not found', 404, 404, { reason: 'NOTE_TAG_NOT_FOUND' })
    if (tag !== newTag && tags.includes(newTag)) throw new HttpError('Note tag already exists', 409, 409, { reason: 'NOTE_TAG_ALREADY_EXISTS' })
    return tags.map((item) => item === tag ? newTag : item)
  })
}
