/**
 * @file project-version-release.ts
 * @project SlothVault
 * @module Project Version Release
 * @description Defines canonical release manifests and owns atomic project-version publication, visibility, integrity, cloning, and write freezing.
 * @logic Serialize draft writes through a version revision lock, validate the enabled document tree, publish one immutable release identity, rebuild it for verification, and clone frozen trees into new drafts.
 * @dependencies node:crypto, Prisma transactions, database unit-of-work, public project cache
 * @index_tags project-version,release,manifest,sha256,publication,integrity,clone,transaction
 * @author holic512
 */
import 'server-only'

import { createHash, randomUUID } from 'node:crypto'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { HttpError } from '@/server/http/errors'
import { unitOfWork } from '@/server/database/unit-of-work'
import { prisma } from '@/server/prisma'
import { invalidatePublicProjectCache } from '@/server/services/public-project-cache'

export const RELEASE_MANIFEST_VERSION = 1
const MAX_SERIALIZABLE_ATTEMPTS = 3

export type ReleaseIssue = {
  code: string
  entity: 'projectVersion' | 'project' | 'category' | 'note' | 'content' | 'release'
  entityId: string
  message: string
}

export type ReleaseManifest = {
  schema: 1
  releaseId: string
  version: {
    label: string
    description: string | null
    weight: number
  }
  categories: Array<{
    name: string
    weight: number
    status: number
    notes: Array<{
      title: string
      weight: number
      status: number
      content: {
        versionNote: string | null
        status: number
        markdown: string
      }
    }>
  }>
}

export type ReleaseTreeSource = {
  id: number
  version: string
  description: string | null
  weight: number
  project: { id: number; isDeleted: boolean }
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

type DatabaseReader = Pick<Prisma.TransactionClient, 'projectVersion'>

export async function projectVersionIdForCategory(
  tx: Prisma.TransactionClient,
  categoryId: number,
) {
  const category = await tx.category.findUnique({
    where: { id: categoryId },
    select: { projectVersionId: true },
  })
  if (!category) throw new HttpError('Category not found', 404, 404)
  return category.projectVersionId
}

export async function projectVersionIdForNote(
  tx: Prisma.TransactionClient,
  noteInfoId: number,
) {
  const note = await tx.noteInfo.findUnique({
    where: { id: noteInfoId },
    select: { category: { select: { projectVersionId: true } } },
  })
  if (!note) throw new HttpError('NoteInfo not found', 404, 404)
  return note.category.projectVersionId
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

function stableNodeCompare<T extends { weight: number }>(
  labelOf: (node: T) => string,
) {
  return (left: T, right: T) => {
    const weight = right.weight - left.weight
    if (weight !== 0) return weight

    const label = byteCompare(utf8(labelOf(left)), utf8(labelOf(right)))
    if (label !== 0) return label

    const leftBytes = utf8(JSON.stringify(left))
    const rightBytes = utf8(JSON.stringify(right))
    const digest = byteCompare(utf8(sha256(leftBytes)), utf8(sha256(rightBytes)))
    return digest !== 0 ? digest : byteCompare(leftBytes, rightBytes)
  }
}

function issue(
  code: string,
  entity: ReleaseIssue['entity'],
  entityId: number | string,
  message: string,
): ReleaseIssue {
  return { code, entity, entityId: String(entityId), message }
}

function issueCompare(left: ReleaseIssue, right: ReleaseIssue) {
  return (
    byteCompare(utf8(left.entity), utf8(right.entity)) ||
    byteCompare(utf8(left.entityId), utf8(right.entityId)) ||
    byteCompare(utf8(left.code), utf8(right.code)) ||
    byteCompare(utf8(left.message), utf8(right.message))
  )
}

export function buildReleaseManifest(
  source: ReleaseTreeSource,
  releaseId: string,
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

      return [{
        title: note.noteTitle,
        weight: note.weight,
        status: note.status,
        content: {
          versionNote: content.versionNote,
          status: content.status,
          markdown: content.content,
        },
      }]
    }).sort(stableNodeCompare((note) => note.title))

    return {
      name: category.categoryName,
      weight: category.weight,
      status: category.status,
      notes,
    }
  }).sort(stableNodeCompare((category) => category.name))

  issues.sort(issueCompare)
  if (issues.length > 0) return { manifest: null, bytes: null, hash: null, issues }

  const manifest: ReleaseManifest = {
    schema: RELEASE_MANIFEST_VERSION,
    releaseId,
    version: {
      label: source.version,
      description: source.description,
      weight: source.weight,
    },
    categories,
  }
  const bytes = utf8(JSON.stringify(manifest))
  return { manifest, bytes, hash: sha256(bytes), issues: [] }
}

export async function loadReleaseTree(
  reader: DatabaseReader,
  projectVersionId: number,
): Promise<ReleaseTreeSource | null> {
  return reader.projectVersion.findUnique({
    where: { id: projectVersionId },
    select: {
      id: true,
      version: true,
      description: true,
      weight: true,
      project: { select: { id: true, isDeleted: true } },
      categories: {
        select: {
          id: true,
          categoryName: true,
          weight: true,
          status: true,
          isDeleted: true,
          noteInfos: {
            select: {
              id: true,
              noteTitle: true,
              weight: true,
              status: true,
              isDeleted: true,
              contents: {
                select: {
                  id: true,
                  content: true,
                  versionNote: true,
                  isPrimary: true,
                  status: true,
                  isDeleted: true,
                },
              },
            },
          },
        },
      },
    },
  })
}

function hasPrismaCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

export async function executeVersionWrite<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await unitOfWork.execute(operation, {
        mode: 'write',
        isolationLevel: 'Serializable',
      })
    } catch (error) {
      if (!hasPrismaCode(error, 'P2034')) throw error
      if (attempt === MAX_SERIALIZABLE_ATTEMPTS) {
        throw new HttpError('Version write conflict', 409, 409, {
          reason: 'VERSION_WRITE_CONFLICT',
        })
      }
    }
  }
  throw new HttpError('Version write conflict', 409, 409, {
    reason: 'VERSION_WRITE_CONFLICT',
  })
}

export async function lockDraftProjectVersions(
  tx: Prisma.TransactionClient,
  projectVersionIds: number[],
) {
  const ids = [...new Set(projectVersionIds)].sort((left, right) => left - right)
  for (const id of ids) {
    const locked = await tx.projectVersion.updateMany({
      where: { id, isDeleted: false, publishedAt: null },
      data: { documentRevision: { increment: 1 }, updatedAt: new Date() },
    })
    if (locked.count === 1) continue

    const version = await tx.projectVersion.findUnique({
      where: { id },
      select: { isDeleted: true, publishedAt: true },
    })
    if (!version || version.isDeleted) throw new HttpError('ProjectVersion not found', 404, 404)
    throw new HttpError('Published project version is frozen', 409, 409, {
      reason: 'VERSION_FROZEN',
      projectVersionId: String(id),
    })
  }
}

async function lockPublishedProjectVersion(tx: Prisma.TransactionClient, id: number) {
  const locked = await tx.projectVersion.updateMany({
    where: { id, isDeleted: false, publishedAt: { not: null } },
    data: { documentRevision: { increment: 1 }, updatedAt: new Date() },
  })
  if (locked.count === 1) return

  const version = await tx.projectVersion.findUnique({
    where: { id },
    select: { isDeleted: true, publishedAt: true },
  })
  if (!version || version.isDeleted) throw new HttpError('ProjectVersion not found', 404, 404)
  throw new HttpError('Project version is not published', 409, 409, {
    reason: 'VERSION_NOT_PUBLISHED',
  })
}

type PublishedReleaseRecord = {
  id: number
  projectId: number
  status: number
  releaseId: string
  releaseHash: string
  manifestVersion: number
  publishedAt: Date
}

function requireCompleteReleaseFields(version: {
  id: number
  projectId: number
  status: number
  releaseId: string | null
  releaseHash: string | null
  manifestVersion: number | null
  publishedAt: Date | null
}): PublishedReleaseRecord {
  if (
    !version.releaseId ||
    !version.releaseHash ||
    version.manifestVersion === null ||
    !version.publishedAt
  ) {
    throw new HttpError('Published release metadata is incomplete', 409, 409, {
      reason: 'RELEASE_METADATA_INCOMPLETE',
    })
  }
  return version as PublishedReleaseRecord
}

function releaseDto(version: PublishedReleaseRecord) {
  return {
    projectVersionId: String(version.id),
    releaseId: version.releaseId,
    releaseHash: version.releaseHash,
    manifestVersion: version.manifestVersion,
    publishedAt: version.publishedAt,
    status: version.status,
  }
}

export async function publishProjectVersion(projectVersionId: number) {
  const result = await executeVersionWrite(async (tx) => {
    const initial = await tx.projectVersion.findUnique({
      where: { id: projectVersionId },
      select: {
        id: true,
        projectId: true,
        status: true,
        isDeleted: true,
        releaseId: true,
        releaseHash: true,
        manifestVersion: true,
        publishedAt: true,
        project: { select: { isDeleted: true, status: true } },
      },
    })
    if (!initial || initial.isDeleted) throw new HttpError('ProjectVersion not found', 404, 404)
    const anyReleaseMetadata =
      initial.publishedAt !== null ||
      initial.releaseId !== null ||
      initial.releaseHash !== null ||
      initial.manifestVersion !== null
    if (anyReleaseMetadata) return requireCompleteReleaseFields(initial)
    if (initial.project.isDeleted || initial.project.status !== 1) {
      throw new HttpError('Project version is not ready to publish', 422, 422, {
        reason: 'RELEASE_VALIDATION_FAILED',
        issues: [
          issue(
            'PROJECT_INACTIVE',
            'project',
            initial.projectId,
            'Parent project must be enabled and undeleted',
          ),
        ],
      })
    }

    const locked = await tx.projectVersion.updateMany({
      where: { id: projectVersionId, isDeleted: false, publishedAt: null },
      data: { documentRevision: { increment: 1 }, updatedAt: new Date() },
    })
    if (locked.count === 0) {
      const concurrent = await tx.projectVersion.findUnique({
        where: { id: projectVersionId },
        select: {
          id: true,
          projectId: true,
          status: true,
          isDeleted: true,
          releaseId: true,
          releaseHash: true,
          manifestVersion: true,
          publishedAt: true,
        },
      })
      if (!concurrent || concurrent.isDeleted) {
        throw new HttpError('ProjectVersion not found', 404, 404)
      }
      return requireCompleteReleaseFields(concurrent)
    }
    const activeProject = await tx.project.updateMany({
      where: { id: initial.projectId, isDeleted: false, status: 1 },
      data: { updatedAt: new Date() },
    })
    if (activeProject.count === 0) {
      throw new HttpError('Project version is not ready to publish', 422, 422, {
        reason: 'RELEASE_VALIDATION_FAILED',
        issues: [
          issue(
            'PROJECT_INACTIVE',
            'project',
            initial.projectId,
            'Parent project must be enabled and undeleted',
          ),
        ],
      })
    }
    const source = await loadReleaseTree(tx, projectVersionId)
    if (!source) throw new HttpError('ProjectVersion not found', 404, 404)

    const releaseId = randomUUID()
    const built = buildReleaseManifest(source, releaseId)
    if (!built.manifest || !built.hash) {
      throw new HttpError('Project version is not ready to publish', 422, 422, {
        reason: 'RELEASE_VALIDATION_FAILED',
        issues: built.issues,
      })
    }

    const publishedAt = new Date()
    try {
      const updated = await tx.projectVersion.update({
        where: { id: projectVersionId },
        data: {
          releaseId,
          releaseHash: built.hash,
          manifestVersion: RELEASE_MANIFEST_VERSION,
          publishedAt,
          status: 1,
          updatedAt: publishedAt,
        },
        select: {
          id: true,
          projectId: true,
          status: true,
          releaseId: true,
          releaseHash: true,
          manifestVersion: true,
          publishedAt: true,
        },
      })
      return requireCompleteReleaseFields(updated)
    } catch (error) {
      if (hasPrismaCode(error, 'P2002')) {
        throw new HttpError('Release identity conflict', 409, 409, {
          reason: 'RELEASE_IDENTITY_CONFLICT',
        })
      }
      throw error
    }
  })
  await invalidatePublicProjectCache(result.projectId)
  return releaseDto(result)
}

export async function setProjectVersionVisibility(projectVersionId: number, status: 0 | 1) {
  const result = await executeVersionWrite(async (tx) => {
    await lockPublishedProjectVersion(tx, projectVersionId)
    const updated = await tx.projectVersion.update({
      where: { id: projectVersionId },
      data: { status, updatedAt: new Date() },
      select: {
        id: true,
        projectId: true,
        status: true,
        releaseId: true,
        releaseHash: true,
        manifestVersion: true,
        publishedAt: true,
      },
    })
    return requireCompleteReleaseFields(updated)
  })
  await invalidatePublicProjectCache(result.projectId)
  return releaseDto(result)
}

export async function setProjectVersionsVisibility(
  projectVersionIds: number[],
  status: 0 | 1,
) {
  const ids = [...new Set(projectVersionIds)].sort((left, right) => left - right)
  const projectIds = await executeVersionWrite(async (tx) => {
    for (const id of ids) await lockPublishedProjectVersion(tx, id)
    const versions = await tx.projectVersion.findMany({
      where: { id: { in: ids } },
      select: { projectId: true },
    })
    await tx.projectVersion.updateMany({
      where: { id: { in: ids }, publishedAt: { not: null } },
      data: { status, updatedAt: new Date() },
    })
    return [...new Set(versions.map((version) => version.projectId))]
  })
  await Promise.all(projectIds.map((projectId) => invalidatePublicProjectCache(projectId)))
  return { count: ids.length }
}

export async function getProjectVersionIntegrity(projectVersionId: number) {
  const version = await prisma.projectVersion.findUnique({
    where: { id: projectVersionId },
    select: {
      id: true,
      isDeleted: true,
      releaseId: true,
      releaseHash: true,
      manifestVersion: true,
      publishedAt: true,
    },
  })
  if (!version || version.isDeleted) throw new HttpError('ProjectVersion not found', 404, 404)
  if (!version.publishedAt) {
    throw new HttpError('Project version is not published', 409, 409, {
      reason: 'VERSION_NOT_PUBLISHED',
    })
  }

  const metadataIssues: ReleaseIssue[] = []
  if (!version.releaseId || !version.releaseHash || version.manifestVersion === null) {
    metadataIssues.push(
      issue(
        'RELEASE_METADATA_INCOMPLETE',
        'release',
        version.id,
        'Published release metadata is incomplete',
      ),
    )
  } else if (version.manifestVersion !== RELEASE_MANIFEST_VERSION) {
    metadataIssues.push(
      issue(
        'MANIFEST_VERSION_UNSUPPORTED',
        'release',
        version.id,
        `Unsupported manifest version ${version.manifestVersion}`,
      ),
    )
  }

  let built: BuiltRelease = { manifest: null, bytes: null, hash: null, issues: [] }
  if (metadataIssues.length === 0 && version.releaseId) {
    const source = await loadReleaseTree(prisma, projectVersionId)
    if (!source) throw new HttpError('ProjectVersion not found', 404, 404)
    built = buildReleaseManifest(source, version.releaseId)
  }
  const issues = [...metadataIssues, ...built.issues].sort(issueCompare)
  if (built.hash && version.releaseHash && built.hash !== version.releaseHash) {
    issues.push(
      issue(
        'RELEASE_HASH_MISMATCH',
        'release',
        version.id,
        'Stored release hash does not match the canonical manifest',
      ),
    )
  }

  return {
    releaseId: version.releaseId,
    storedHash: version.releaseHash,
    computedHash: built.hash,
    valid: issues.length === 0 && built.hash === version.releaseHash,
    manifestVersion: version.manifestVersion,
    publishedAt: version.publishedAt,
    issues,
    manifest: built.manifest,
    bytes: built.bytes,
  }
}

export async function getProjectVersionManifest(
  projectVersionId: number,
  options: { publicProjectId?: number } = {},
) {
  if (options.publicProjectId !== undefined) {
    const visible = await prisma.projectVersion.findFirst({
      where: {
        id: projectVersionId,
        projectId: options.publicProjectId,
        isDeleted: false,
        status: 1,
        publishedAt: { not: null },
        project: { isDeleted: false, status: 1 },
      },
      select: { id: true },
    })
    if (!visible) throw new HttpError('Version not found', 404, 404)
  }

  const integrity = await getProjectVersionIntegrity(projectVersionId)
  if (!integrity.valid || !integrity.bytes || !integrity.releaseId || !integrity.storedHash) {
    throw new HttpError('Release integrity verification failed', 409, 409, {
      reason: 'RELEASE_INTEGRITY_FAILED',
      issues: integrity.issues,
    })
  }
  return {
    bytes: integrity.bytes,
    releaseId: integrity.releaseId,
    releaseHash: integrity.storedHash,
  }
}

export async function cloneProjectVersion(
  projectVersionId: number,
  input: { version: string; description?: string | null; weight?: number },
) {
  const versionLabel = input.version.trim()
  if (!versionLabel) throw new HttpError('Missing version', 400, 400)

  return executeVersionWrite(async (tx) => {
    await lockPublishedProjectVersion(tx, projectVersionId)
    const source = await tx.projectVersion.findUnique({
      where: { id: projectVersionId },
      include: {
        categories: {
          where: { isDeleted: false },
          include: {
            noteInfos: {
              where: { isDeleted: false },
              include: { contents: { where: { isDeleted: false } } },
            },
          },
        },
      },
    })
    if (!source || source.isDeleted || !source.publishedAt) {
      throw new HttpError('Project version is not published', 409, 409, {
        reason: 'VERSION_NOT_PUBLISHED',
      })
    }

    const created = await tx.projectVersion.create({
      data: {
        projectId: source.projectId,
        version: versionLabel,
        description: input.description === undefined ? source.description : input.description,
        weight: input.weight ?? source.weight,
        status: 0,
      },
    })

    for (const category of source.categories) {
      const clonedCategory = await tx.category.create({
        data: {
          projectVersionId: created.id,
          categoryName: category.categoryName,
          weight: category.weight,
          status: category.status,
        },
      })
      for (const note of category.noteInfos) {
        const clonedNote = await tx.noteInfo.create({
          data: {
            categoryId: clonedCategory.id,
            authorId: note.authorId,
            noteTitle: note.noteTitle,
            weight: note.weight,
            status: note.status,
          },
        })
        for (const content of note.contents) {
          await tx.noteContent.create({
            data: {
              noteInfoId: clonedNote.id,
              content: content.content,
              versionNote: content.versionNote,
              isPrimary: content.isPrimary,
              status: content.status,
            },
          })
        }
      }
    }

    return {
      id: String(created.id),
      projectId: String(created.projectId),
      version: created.version,
      description: created.description,
      weight: created.weight,
      status: created.status,
      releaseId: null,
      releaseHash: null,
      manifestVersion: null,
      publishedAt: null,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      isDeleted: created.isDeleted,
    }
  })
}
