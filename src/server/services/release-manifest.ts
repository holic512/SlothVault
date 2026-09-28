/**
 * @file release-manifest.ts
 * @project SlothVault
 * @module Content Integrity
 * @description Builds byte-exact v2 publication manifests from Markdown alone.
 * @logic Validate enabled primary contents, preserve duplicate bodies and exact text, sort by UTF-8 bytes, then hash canonical JSON independently of editorial metadata.
 * @dependencies node:crypto
 * @index_tags manifest,sha256,content,release,migration
 * @author holic512
 */
import { createHash } from 'node:crypto'

export const RELEASE_MANIFEST_VERSION = 2
export const NOTE_CONTENT_MANIFEST_VERSION = 2

export function buildNoteMarkdownManifest(markdown: string) {
  const manifest = { schema: NOTE_CONTENT_MANIFEST_VERSION, markdown } as const
  const bytes = Buffer.from(JSON.stringify(manifest), 'utf8')
  return { manifest, bytes, hash: createHash('sha256').update(bytes).digest('hex') }
}

export type ReleaseIssue = {
  code: string
  entity: 'projectVersion' | 'project' | 'category' | 'note' | 'content' | 'release'
  entityId: string
  message: string
}

export type ReleaseManifest = { schema: 2; contents: string[] }

export type ReleaseTreeSource = {
  id: number
  version: string
  description: string | null
  weight: number
  publishedAt: Date | null
  isDeleted: boolean
  project: { id: number; status: number; isDeleted: boolean }
  categories: Array<{
    id: number
    categoryName: string
    weight: number
    status: number
    isDeleted: boolean
    noteInfos: Array<{
      id: number
      noteTitle: string
      weight: number
      status: number
      isDeleted: boolean
      contents: Array<{
        id: number
        content: string
        versionNote: string | null
        isPrimary: boolean
        status: number
        isDeleted: boolean
      }>
    }>
  }>
}

export type BuiltRelease = {
  manifest: ReleaseManifest | null
  bytes: Uint8Array | null
  hash: string | null
  issues: ReleaseIssue[]
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function utf8(value: string) {
  return Buffer.from(value, 'utf8')
}

function byteCompare(left: Uint8Array, right: Uint8Array) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

export function issue(
  code: string,
  entity: ReleaseIssue['entity'],
  entityId: number | string,
  message: string,
): ReleaseIssue {
  return { code, entity, entityId: String(entityId), message }
}

export function issueCompare(left: ReleaseIssue, right: ReleaseIssue) {
  return (
    byteCompare(utf8(left.entity), utf8(right.entity)) ||
    byteCompare(utf8(left.entityId), utf8(right.entityId)) ||
    byteCompare(utf8(left.code), utf8(right.code)) ||
    byteCompare(utf8(left.message), utf8(right.message))
  )
}

export function buildReleaseManifest(
  source: ReleaseTreeSource,
): BuiltRelease {
  const issues: ReleaseIssue[] = []
  const enabledCategories = source.categories.filter(
    (category) => !category.isDeleted && category.status === 1,
  )
  if (enabledCategories.length === 0) {
    issues.push(
      issue(
        'NO_ENABLED_CATEGORY',
        'projectVersion',
        source.id,
        'At least one enabled category is required',
      ),
    )
  }

  const categories = enabledCategories.map((category) => {
    const enabledNotes = category.noteInfos.filter(
      (note) => !note.isDeleted && note.status === 1,
    )
    if (enabledNotes.length === 0) {
      issues.push(
        issue(
          'CATEGORY_NO_ENABLED_NOTE',
          'category',
          category.id,
          'Enabled category must contain at least one enabled note',
        ),
      )
    }

    const notes = enabledNotes.flatMap((note) => {
      const primaryContents = note.contents.filter(
        (content) => !content.isDeleted && content.isPrimary,
      )
      if (primaryContents.length !== 1) {
        issues.push(
          issue(
            'NOTE_PRIMARY_COUNT',
            'note',
            note.id,
            'Enabled note must have exactly one undeleted primary content',
          ),
        )
        return []
      }

      const content = primaryContents[0]
      if (content.status !== 1) {
        issues.push(
          issue(
            'NOTE_PRIMARY_DISABLED',
            'content',
            content.id,
            'Primary content must be enabled',
          ),
        )
      }
      if (content.content.trim().length === 0) {
        issues.push(
          issue(
            'NOTE_PRIMARY_EMPTY',
            'content',
            content.id,
            'Primary content must not be blank',
          ),
        )
      }

      return [content.content]
    })

    return notes
  })

  issues.sort(issueCompare)
  if (issues.length > 0) return { manifest: null, bytes: null, hash: null, issues }

  const manifest: ReleaseManifest = {
    schema: RELEASE_MANIFEST_VERSION,
    contents: categories.flat().sort((left, right) => byteCompare(utf8(left), utf8(right))),
  }
  const bytes = utf8(JSON.stringify(manifest))
  return { manifest, bytes, hash: sha256(bytes), issues: [] }
}
