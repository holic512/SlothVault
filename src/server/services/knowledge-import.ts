/**
 * @file knowledge-import.ts
 * @project SlothVault
 * @module Knowledge Package Import
 * @description Imports validated Skill-produced project or single-article packages into the existing draft project-document tree.
 * @logic Accept one bounded multipart ZIP, preserve its structured provenance, create new project-version drafts for project packages, append article packages only to draft versions, and write categories, notes, primary Markdown, and source references atomically.
 * @dependencies Prisma, Zod, knowledge package contract, project version release service, HTTP errors
 * @index_tags knowledge-package, import, project-version, article, markdown, transaction, admin
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { HttpError } from '@/server/http/errors'
import { executeVersionWrite, lockDraftProjectVersions } from '@/server/services/project-version-release'

import {
  type KnowledgeArticlePayload,
  type KnowledgeBasePayload,
  type ParsedKnowledgePackage,
  parseKnowledgePackage,
} from './knowledge-package'

const REQUEST_CONTENT_LENGTH_MAX_BYTES = 260 * 1024 * 1024

type ImportFields = {
  projectId: string | null
  projectVersionId: string | null
  version: string | null
}

export type KnowledgeImportUpload = {
  parsed: ParsedKnowledgePackage
  fields: ImportFields
}

function parseDecimalId(value: string | null, label: string) {
  if (!value || !/^\d+$/.test(value)) throw new HttpError(`Invalid ${label}`, 400, 400)
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647) {
    throw new HttpError(`Invalid ${label}`, 400, 400)
  }
  return id
}

function normalizedVersion(value: string | null) {
  const version = value?.trim() || ''
  if (!version || version.length > 64) throw new HttpError('Invalid version', 400, 400)
  return version
}

function categoryWeight(order: number) {
  return -order
}

function articleWeight(order: number) {
  return -order
}

function compactSummary(value: string) {
  return value.trim() || null
}

function assertContentLength(request: Request) {
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > REQUEST_CONTENT_LENGTH_MAX_BYTES) {
    throw new HttpError('Knowledge package request body is too large', 413, 413)
  }
}

export async function readKnowledgeImportUpload(request: Request): Promise<KnowledgeImportUpload> {
  assertContentLength(request)
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    throw new HttpError('Expected multipart/form-data', 400, 400)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    throw new HttpError('Invalid multipart form data', 400, 400)
  }

  const packages = formData.getAll('package').filter(
    (entry): entry is File => typeof entry !== 'string',
  )
  if (packages.length !== 1) throw new HttpError('Upload exactly one knowledge package ZIP', 400, 400)

  const file = packages[0]
  if (file.size === 0) throw new HttpError('Knowledge package ZIP is empty', 400, 400)
  const archive = Buffer.from(await file.arrayBuffer())
  return {
    parsed: await parseKnowledgePackage(archive),
    fields: {
      projectId: typeof formData.get('projectId') === 'string' ? String(formData.get('projectId')) : null,
      projectVersionId: typeof formData.get('projectVersionId') === 'string' ? String(formData.get('projectVersionId')) : null,
      version: typeof formData.get('version') === 'string' ? String(formData.get('version')) : null,
    },
  }
}

export function knowledgePackagePreview(parsed: ParsedKnowledgePackage) {
  return {
    kind: parsed.manifest.kind,
    projectName: parsed.knowledgeBase.project.name,
    projectDescription: parsed.knowledgeBase.project.description,
    title: parsed.knowledgeBase.knowledgeBase.title,
    summary: parsed.knowledgeBase.knowledgeBase.summary,
    articleCount: parsed.articleCount,
    categories: parsed.knowledgeBase.categories.map((category) => ({
      id: category.id,
      title: category.title,
      articleCount: category.articles.length,
      articles: category.articles.map((article) => ({
        id: article.id,
        title: article.title,
        articleType: article.articleType,
        sourceReferenceCount: article.sourceReferences.length,
      })),
    })),
    archiveHash: parsed.archiveHash,
    archiveBytes: parsed.archiveBytes,
    createdAt: parsed.manifest.createdAt,
  }
}

async function requireActiveProject(
  tx: Prisma.TransactionClient,
  projectId: number,
) {
  const project = await tx.project.findFirst({
    where: { id: projectId, isDeleted: false, status: 1 },
    select: { id: true, projectName: true },
  })
  if (!project) throw new HttpError('Project not found or disabled', 404, 404)
  return project
}

async function createPackage(
  tx: Prisma.TransactionClient,
  parsed: ParsedKnowledgePackage,
  projectVersionId: number,
) {
  return tx.knowledgePackage.create({
    data: {
      projectVersionId,
      packageKind: parsed.manifest.kind,
      title: parsed.knowledgeBase.knowledgeBase.title,
      summary: compactSummary(parsed.knowledgeBase.knowledgeBase.summary),
      schemaVersion: parsed.manifest.schemaVersion,
      packageHash: parsed.archiveHash,
      manifest: JSON.stringify(parsed.manifest),
    },
  })
}

async function createArticle(
  tx: Prisma.TransactionClient,
  input: {
    packageId: number
    categoryId: number
    authorId: number
    article: KnowledgeArticlePayload
  },
) {
  const note = await tx.noteInfo.create({
    data: {
      categoryId: input.categoryId,
      authorId: input.authorId,
      noteTitle: input.article.title,
      weight: articleWeight(input.article.order),
      status: 1,
      contents: {
        create: {
          content: input.article.content,
          versionNote: `Imported ${input.article.articleType} article`,
          isPrimary: true,
          status: 1,
        },
      },
    },
  })
  await tx.knowledgeArticle.create({
    data: {
      packageId: input.packageId,
      noteInfoId: note.id,
      externalId: input.article.id,
      slug: input.article.slug,
      articleType: input.article.articleType,
      summary: compactSummary(input.article.summary),
      tagsJson: JSON.stringify(input.article.tags),
      sourceReferencesJson: JSON.stringify(input.article.sourceReferences),
    },
  })
  return note
}

async function importTree(
  tx: Prisma.TransactionClient,
  input: {
    parsed: ParsedKnowledgePackage
    projectVersionId: number
    authorId: number
  },
) {
  const packageRecord = await createPackage(tx, input.parsed, input.projectVersionId)
  for (const categoryPayload of input.parsed.knowledgeBase.categories) {
    const category = await tx.category.create({
      data: {
        projectVersionId: input.projectVersionId,
        categoryName: categoryPayload.title,
        weight: categoryWeight(categoryPayload.order),
        status: 1,
      },
    })
    for (const article of categoryPayload.articles) {
      await createArticle(tx, {
        packageId: packageRecord.id,
        categoryId: category.id,
        authorId: input.authorId,
        article,
      })
    }
  }
  return packageRecord
}

export async function importProjectKnowledgePackage(input: {
  parsed: ParsedKnowledgePackage
  projectId: string | null
  version: string | null
  authorId: number
}) {
  if (input.parsed.manifest.kind !== 'project') {
    throw new HttpError('Use the article importer for a single-article package', 400, 400)
  }
  const projectId = parseDecimalId(input.projectId, 'projectId')
  const version = normalizedVersion(input.version)

  return executeVersionWrite(async (tx) => {
    await requireActiveProject(tx, projectId)
    const existing = await tx.projectVersion.findFirst({
      where: { projectId, version, isDeleted: false },
      select: { id: true },
    })
    if (existing) {
      throw new HttpError('This project version already exists', 409, 409, {
        reason: 'PROJECT_VERSION_EXISTS',
        projectVersionId: String(existing.id),
      })
    }

    const projectVersion = await tx.projectVersion.create({
      data: {
        projectId,
        version,
        description: compactSummary(input.parsed.knowledgeBase.knowledgeBase.summary)
          ?? compactSummary(input.parsed.knowledgeBase.project.description),
        weight: 0,
        status: 0,
      },
    })
    const packageRecord = await importTree(tx, {
      parsed: input.parsed,
      projectVersionId: projectVersion.id,
      authorId: input.authorId,
    })
    return {
      projectVersionId: String(projectVersion.id),
      version: projectVersion.version,
      packageId: String(packageRecord.id),
      articleCount: input.parsed.articleCount,
    }
  })
}

async function findOrCreateArticleCategory(
  tx: Prisma.TransactionClient,
  projectVersionId: number,
  knowledgeBase: KnowledgeBasePayload,
) {
  const categoryPayload = knowledgeBase.categories[0]
  const existing = await tx.category.findFirst({
    where: {
      projectVersionId,
      categoryName: categoryPayload.title,
      isDeleted: false,
    },
    select: { id: true },
  })
  if (existing) return existing
  return tx.category.create({
    data: {
      projectVersionId,
      categoryName: categoryPayload.title,
      weight: categoryWeight(categoryPayload.order),
      status: 1,
    },
  })
}

export async function importArticleKnowledgePackage(input: {
  parsed: ParsedKnowledgePackage
  projectId: string | null
  projectVersionId: string | null
  authorId: number
}) {
  if (input.parsed.manifest.kind !== 'article') {
    throw new HttpError('Use the project importer for a project package', 400, 400)
  }
  const projectId = parseDecimalId(input.projectId, 'projectId')
  const projectVersionId = parseDecimalId(input.projectVersionId, 'projectVersionId')
  const article = input.parsed.knowledgeBase.categories[0]?.articles[0]
  if (!article) throw new HttpError('Article package is empty', 400, 400)

  return executeVersionWrite(async (tx) => {
    await requireActiveProject(tx, projectId)
    await lockDraftProjectVersions(tx, [projectVersionId])
    const projectVersion = await tx.projectVersion.findFirst({
      where: { id: projectVersionId, projectId, isDeleted: false, publishedAt: null },
      select: { id: true, version: true },
    })
    if (!projectVersion) throw new HttpError('Draft project version not found', 404, 404)

    const duplicate = await tx.knowledgeArticle.findFirst({
      where: {
        externalId: article.id,
        package: { projectVersionId },
      },
      select: { id: true },
    })
    if (duplicate) {
      throw new HttpError('This article package has already been imported into the version', 409, 409, {
        reason: 'ARTICLE_ALREADY_IMPORTED',
      })
    }

    const category = await findOrCreateArticleCategory(tx, projectVersionId, input.parsed.knowledgeBase)
    const conflictingTitle = await tx.noteInfo.findFirst({
      where: { categoryId: category.id, noteTitle: article.title, isDeleted: false },
      select: { id: true },
    })
    if (conflictingTitle) {
      throw new HttpError('A document with the same title already exists in the target category', 409, 409)
    }

    const packageRecord = await createPackage(tx, input.parsed, projectVersionId)
    const note = await createArticle(tx, {
      packageId: packageRecord.id,
      categoryId: category.id,
      authorId: input.authorId,
      article,
    })
    return {
      projectVersionId: String(projectVersion.id),
      version: projectVersion.version,
      packageId: String(packageRecord.id),
      noteId: String(note.id),
      articleCount: 1,
    }
  })
}
