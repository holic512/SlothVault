/**
 * @file document-content.ts
 * @project SlothVault
 * @module Document Content Contract
 * @description Defines shared size, statistics, and image-upload constraints for Markdown and safe embedded HTML documents.
 * @logic Keep browser feedback and API persistence limits aligned without coupling client code to server-only services.
 * @dependencies Web File metadata
 * @index_tags document,markdown,html,validation,upload,limits
 * @author holic512
 */

export const DOCUMENT_CONTENT_MAX_CHARACTERS = 500_000
export const DOCUMENT_JSON_MAX_BYTES = 4 * 1024 * 1024
export const DOCUMENT_IMAGE_MAX_FILES = 10
export const DOCUMENT_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const DOCUMENT_IMAGE_BATCH_MAX_BYTES = 20 * 1024 * 1024

const DOCUMENT_IMAGE_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])
const DOCUMENT_IMAGE_EXTENSIONS = new Set(['gif', 'jpeg', 'jpg', 'png', 'webp'])

export type DocumentContentStats = {
  characters: number
  lines: number
}

export type DocumentImageConstraintIssue =
  | { code: 'too-many-files'; maximum: number }
  | { code: 'empty-file'; fileName: string }
  | { code: 'unsupported-type'; fileName: string }
  | { code: 'file-too-large'; fileName: string; maximumBytes: number }
  | { code: 'batch-too-large'; maximumBytes: number }

type DocumentImageCandidate = Pick<File, 'name' | 'size' | 'type'>

export function getDocumentContentStats(value: string): DocumentContentStats {
  return {
    characters: value.length,
    lines: value.length === 0 ? 1 : value.split(/\r\n|\r|\n/).length,
  }
}

export function isDocumentContentWithinLimit(value: unknown): value is string {
  return typeof value === 'string' && value.length <= DOCUMENT_CONTENT_MAX_CHARACTERS
}

export function validateDocumentImages(
  files: readonly DocumentImageCandidate[],
): DocumentImageConstraintIssue | null {
  if (files.length > DOCUMENT_IMAGE_MAX_FILES) {
    return { code: 'too-many-files', maximum: DOCUMENT_IMAGE_MAX_FILES }
  }

  let totalBytes = 0
  for (const file of files) {
    if (file.size === 0) return { code: 'empty-file', fileName: file.name }

    const extension = file.name.split('.').pop()?.toLocaleLowerCase() || ''
    const supportedType = file.type
      ? DOCUMENT_IMAGE_MIME_TYPES.has(file.type.toLocaleLowerCase())
      : DOCUMENT_IMAGE_EXTENSIONS.has(extension)
    if (!supportedType) return { code: 'unsupported-type', fileName: file.name }

    if (file.size > DOCUMENT_IMAGE_MAX_BYTES) {
      return {
        code: 'file-too-large',
        fileName: file.name,
        maximumBytes: DOCUMENT_IMAGE_MAX_BYTES,
      }
    }

    totalBytes += file.size
    if (totalBytes > DOCUMENT_IMAGE_BATCH_MAX_BYTES) {
      return { code: 'batch-too-large', maximumBytes: DOCUMENT_IMAGE_BATCH_MAX_BYTES }
    }
  }

  return null
}
