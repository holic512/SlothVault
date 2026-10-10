/**
 * @file release-manifest.ts
 * @project SlothVault
 * @module Content Integrity
 * @description Builds compact v3 version credentials from a deterministic category and Markdown hash tree.
 * @logic Hash exact primary bodies and their named hierarchy, then bind the aggregate to a publication name snapshot without exposing bodies or database identities.
 * @dependencies node:crypto
 * @index_tags manifest,sha256,content,release,migration
 * @author holic512
 */
import { createHash } from 'node:crypto'

export const RELEASE_MANIFEST_VERSION = 3

export type ReleaseIssue = {
  code: string
  entity: 'projectVersion' | 'project' | 'category' | 'note' | 'content' | 'release'
  entityId: string
  message: string
}

export type ReleaseManifest = { schema: 3; projectName: string; version: string; contentHash: string }

export function canonicalReleaseManifest(manifest: ReleaseManifest) {
  return JSON.stringify({ schema: RELEASE_MANIFEST_VERSION, projectName: manifest.projectName, version: manifest.version, contentHash: manifest.contentHash })
}

export function parseReleaseManifest(json: string | null): ReleaseManifest {
  if (!json) throw new Error('Publication manifest snapshot is missing')
  const value = JSON.parse(json) as ReleaseManifest
  if (value.schema !== RELEASE_MANIFEST_VERSION || typeof value.projectName !== 'string' || !value.projectName || typeof value.version !== 'string' || !value.version || typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentHash) || canonicalReleaseManifest(value) !== json) {
    throw new Error('Publication manifest snapshot is not canonical v3 JSON')
  }
  return value
}

export function releaseManifestHash(json: string) {
  return sha256(utf8(json))
}

export type ReleaseTreeSource = {
  id: number
  version: string
  description: string | null
  weight: number
  publishedAt: Date | null
  isDeleted: boolean
  project: { id: number; projectName: string; status: number; isDeleted: boolean }
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
  projectNameSnapshot = source.project.projectName,
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

      return [{ title: note.noteTitle, hash: sha256(utf8(content.content)) }]
    })

    notes.sort((left, right) => byteCompare(utf8(left.title), utf8(right.title)) || byteCompare(utf8(left.hash), utf8(right.hash)))
    return { name: category.categoryName, notes }
  })

  issues.sort(issueCompare)
  if (issues.length > 0) return { manifest: null, bytes: null, hash: null, issues }

  categories.sort((left, right) => byteCompare(utf8(left.name), utf8(right.name)) || byteCompare(utf8(JSON.stringify(left.notes)), utf8(JSON.stringify(right.notes))))
  const contentHash = sha256(utf8(JSON.stringify({ schema: RELEASE_MANIFEST_VERSION, categories })))
  const manifest: ReleaseManifest = {
    schema: RELEASE_MANIFEST_VERSION,
    projectName: projectNameSnapshot,
    version: source.version,
    contentHash,
  }
  const bytes = utf8(canonicalReleaseManifest(manifest))
  return { manifest, bytes, hash: sha256(bytes), issues: [] }
}
