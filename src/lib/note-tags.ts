/**
 * @file note-tags.ts
 * @project SlothVault
 * @module Note Tags
 * @description Defines the shared normalized note-tag contract and portable JSON storage conversion.
 * @logic Trim and remove empty tags, retain unique case-sensitive values in input order, validate limits, and decode legacy null storage as an empty list.
 * @dependencies zod
 * @index_tags notes,tags,validation,metadata
 * @author holic512
 */
import { z } from 'zod'

export const NOTE_TAG_MAX_COUNT = 10
export const NOTE_TAG_MAX_LENGTH = 30

export const noteTagSchema = z.string().trim().min(1).max(NOTE_TAG_MAX_LENGTH)

export const noteTagsSchema = z.array(z.string()).transform((tags) =>
  [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))],
).pipe(z.array(noteTagSchema).max(NOTE_TAG_MAX_COUNT))

export function readNoteTags(tagsJson: string | null | undefined): string[] {
  return tagsJson == null ? [] : noteTagsSchema.parse(JSON.parse(tagsJson))
}
