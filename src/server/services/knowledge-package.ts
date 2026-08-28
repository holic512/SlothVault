/**
 * @file knowledge-package.ts
 * @project SlothVault
 * @module Knowledge Package Contract
 * @description Validates the portable project and single-article ZIP contract produced by the repository knowledge-base Skill.
 * @logic Safely inspect bounded ZIP entries, verify declared payload digests, parse one structured article tree, and reject inconsistent Markdown mirrors before import code sees content.
 * @dependencies Zod, Unzipper, backup ZIP validation, HTTP errors
 * @index_tags knowledge-package, import, zip, schema, validation, markdown, source-references
 * @author holic512
 */
import 'server-only'

import { createHash } from 'node:crypto'

import { z } from 'zod'

import { DOCUMENT_CONTENT_MAX_CHARACTERS } from '@/lib/document-content'
import { HttpError } from '@/server/http/errors'
import { ZIP_FILE_MAX_BYTES } from '@/server/services/admin-backup/constants'
import {
  validateZipArchive,
  type ValidatedZipEntry,
} from '@/server/services/admin-backup/zip-validation'

export const KNOWLEDGE_PACKAGE_FORMAT = 'slothvault.knowledge-package'
export const KNOWLEDGE_PACKAGE_SCHEMA_VERSION = 1
export const KNOWLEDGE_PACKAGE_MAX_ARTICLES = 500
const KNOWLEDGE_PACKAGE_JSON_MAX_BYTES = 32 * 1024 * 1024
const ARTICLE_MARKDOWN_MAX_BYTES = DOCUMENT_CONTENT_MAX_CHARACTERS * 4

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const safeIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
const slugSchema = z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

const sourceReferenceSchema = z.object({
  path: z.string().trim().min(1).max(1024),
  symbol: z.string().trim().min(1).max(512).optional(),
  kind: z.string().trim().min(1).max(64).optional(),
  note: z.string().trim().min(1).max(1000).optional(),
}).strict()

const articleSchema = z.object({
  id: safeIdSchema,
  title: z.string().trim().min(1).max(255),
  slug: slugSchema,
  summary: z.string().trim().max(2000).default(''),
  articleType: z.string().trim().min(1).max(64),
  tags: z.array(z.string().trim().min(1).max(64)).max(30).default([]),
  order: z.number().int().min(0).max(1_000_000),
  sourceReferences: z.array(sourceReferenceSchema).min(1).max(500),
  content: z.string().min(1).max(500_000),
}).strict()

const categorySchema = z.object({
  id: safeIdSchema,
  title: z.string().trim().min(1).max(64),
  order: z.number().int().min(0).max(1_000_000),
  articles: z.array(articleSchema).min(1).max(KNOWLEDGE_PACKAGE_MAX_ARTICLES),
}).strict()

const knowledgeBaseSchema = z.object({
  project: z.object({
    name: z.string().trim().min(1).max(128),
    description: z.string().trim().max(2000).default(''),
  }).strict(),
  knowledgeBase: z.object({
    title: z.string().trim().min(1).max(255),
    summary: z.string().trim().max(2000).default(''),
  }).strict(),
  categories: z.array(categorySchema).min(1).max(100),
}).strict()

const manifestSchema = z.object({
  format: z.literal(KNOWLEDGE_PACKAGE_FORMAT),
  schemaVersion: z.literal(KNOWLEDGE_PACKAGE_SCHEMA_VERSION),
  kind: z.enum(['project', 'article']),
  createdAt: z.string().datetime(),
  payloads: z.array(z.object({
    path: z.string().min(1).max(1024).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/),
    sha256: digestSchema,
    bytes: z.number().int().min(1).max(KNOWLEDGE_PACKAGE_JSON_MAX_BYTES),
  }).strict()).min(1).max(KNOWLEDGE_PACKAGE_MAX_ARTICLES + 1),
}).strict()

export type KnowledgeArticlePayload = z.infer<typeof articleSchema>
export type KnowledgeCategoryPayload = z.infer<typeof categorySchema>
export type KnowledgeBasePayload = z.infer<typeof knowledgeBaseSchema>
export type KnowledgePackageManifest = z.infer<typeof manifestSchema>

export type ParsedKnowledgePackage = {
  archiveHash: string
  archiveBytes: number
  manifest: KnowledgePackageManifest
  knowledgeBase: KnowledgeBasePayload
  articleCount: number
}

function sha256(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

function findEntry(entries: ValidatedZipEntry[], path: string) {
  return entries.find((item) => item.kind === 'file' && item.relativePath === path)
}

async function readTextEntry(entries: ValidatedZipEntry[], path: string, maxBytes: number) {
  const item = findEntry(entries, path)
  if (!item) throw new HttpError(`Knowledge package is missing ${path}`, 400, 400)
  const buffer = await item.entry.buffer()
  if (buffer.length > maxBytes) throw new HttpError(`Knowledge package entry is too large: ${path}`, 400, 400)
  return { buffer, text: buffer.toString('utf8') }
}

function parseJson<T>(text: string, schema: z.ZodType<T>, path: string) {
  try {
    return schema.parse(JSON.parse(text) as unknown)
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new HttpError(`Invalid knowledge package ${path}`, 400, 400, error.flatten())
    }
    throw new HttpError(`Invalid JSON in ${path}`, 400, 400)
  }
}

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) {
    throw new HttpError(`Knowledge package contains duplicate ${label}`, 400, 400)
  }
}

function validateKnowledgeTree(value: KnowledgeBasePayload, kind: KnowledgePackageManifest['kind']) {
  assertUnique(value.categories.map((category) => category.id), 'category ids')
  assertUnique(value.categories.map((category) => String(category.order)), 'category order values')

  const articles = value.categories.flatMap((category) => category.articles)
  if (articles.length > KNOWLEDGE_PACKAGE_MAX_ARTICLES) {
    throw new HttpError('Knowledge package contains too many articles', 400, 400)
  }
  assertUnique(articles.map((article) => article.id), 'article ids')
  assertUnique(articles.map((article) => article.slug), 'article slugs')

  for (const category of value.categories) {
    assertUnique(category.articles.map((article) => String(article.order)), `article order values in ${category.title}`)
  }
  if (kind === 'article' && (value.categories.length !== 1 || articles.length !== 1)) {
    throw new HttpError('Article packages must contain exactly one category and one article', 400, 400)
  }
}

async function validatePayloadDigests(
  entries: ValidatedZipEntry[],
  manifest: KnowledgePackageManifest,
  knowledgeBase: KnowledgeBasePayload,
) {
  const expectedPaths = [
    'knowledge-base.json',
    ...knowledgeBase.categories.flatMap((category) =>
      category.articles.map((article) => `articles/${article.slug}.md`),
    ),
  ]
  assertUnique(manifest.payloads.map((payload) => payload.path), 'manifest payload paths')
  if (manifest.payloads.length !== expectedPaths.length) {
    throw new HttpError('Knowledge package manifest contains undeclared payloads', 400, 400)
  }

  const expectedArchiveFiles = new Set(['manifest.json', ...expectedPaths])
  const actualArchiveFiles = entries
    .filter((entry) => entry.kind === 'file')
    .map((entry) => entry.relativePath)
  if (
    actualArchiveFiles.length !== expectedArchiveFiles.size ||
    actualArchiveFiles.some((path) => !expectedArchiveFiles.has(path))
  ) {
    throw new HttpError('Knowledge package contains unsupported files', 400, 400)
  }

  for (const path of expectedPaths) {
    const payload = manifest.payloads.find((item) => item.path === path)
    if (!payload) throw new HttpError(`Knowledge package manifest is missing ${path}`, 400, 400)
    const { buffer } = await readTextEntry(
      entries,
      path,
      path === 'knowledge-base.json' ? KNOWLEDGE_PACKAGE_JSON_MAX_BYTES : ARTICLE_MARKDOWN_MAX_BYTES,
    )
    if (buffer.length !== payload.bytes || sha256(buffer) !== payload.sha256) {
      throw new HttpError(`Knowledge package payload hash mismatch: ${path}`, 400, 400)
    }
  }

  for (const category of knowledgeBase.categories) {
    for (const article of category.articles) {
      const markdownPath = `articles/${article.slug}.md`
      const { text } = await readTextEntry(entries, markdownPath, ARTICLE_MARKDOWN_MAX_BYTES)
      if (text !== article.content) {
        throw new HttpError(`Knowledge package Markdown mirror differs: ${markdownPath}`, 400, 400)
      }
    }
  }
}

export async function parseKnowledgePackage(archive: Buffer): Promise<ParsedKnowledgePackage> {
  if (archive.length === 0 || archive.length > ZIP_FILE_MAX_BYTES) {
    throw new HttpError('Knowledge package ZIP exceeds the 250MB limit', 413, 413)
  }

  const entries = await validateZipArchive(archive)
  const manifestEntry = await readTextEntry(entries, 'manifest.json', 256_000)
  const knowledgeBaseEntry = await readTextEntry(
    entries,
    'knowledge-base.json',
    KNOWLEDGE_PACKAGE_JSON_MAX_BYTES,
  )
  const manifest = parseJson(manifestEntry.text, manifestSchema, 'manifest.json')
  const knowledgeBase = parseJson(knowledgeBaseEntry.text, knowledgeBaseSchema, 'knowledge-base.json')
  validateKnowledgeTree(knowledgeBase, manifest.kind)
  await validatePayloadDigests(entries, manifest, knowledgeBase)

  return {
    archiveHash: sha256(archive),
    archiveBytes: archive.length,
    manifest,
    knowledgeBase,
    articleCount: knowledgeBase.categories.reduce((count, category) => count + category.articles.length, 0),
  }
}
