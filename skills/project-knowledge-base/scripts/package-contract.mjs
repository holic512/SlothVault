/**
 * @file package-contract.mjs
 * @project SlothVault
 * @module Knowledge Package Skill Contract
 * @description Shares the strict SlothVault knowledge-package schema, source-evidence checks, and archive limits used by the Skill builder and validator.
 * @logic Validate every authored field before packaging, resolve every cited source file under an explicit project root, and reject ZIP layouts that cannot satisfy the importer contract.
 * @dependencies Node.js crypto, filesystem, path APIs, Unzipper 0.12.5
 * @index_tags skill, knowledge-package, contract, validation, source-references, zip
 * @author holic512
 */
import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path'

import unzipper from 'unzipper'

export const PACKAGE_FORMAT = 'slothvault.knowledge-package'
export const PACKAGE_SCHEMA_VERSION = 1
export const MAX_CATEGORIES = 100
export const MAX_ARTICLES = 500
export const MAX_ARTICLES_PER_CATEGORY = 500
export const MAX_ARTICLE_CHARACTERS = 500_000
export const MAX_ARTICLE_UTF8_BYTES = MAX_ARTICLE_CHARACTERS * 4
export const MAX_KNOWLEDGE_JSON_BYTES = 32 * 1024 * 1024
export const MAX_MANIFEST_BYTES = 256_000
export const MAX_ZIP_BYTES = 250 * 1024 * 1024
export const MAX_ZIP_ENTRIES = 10_000
export const MAX_ZIP_ENTRY_BYTES = 256 * 1024 * 1024
export const MAX_ZIP_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024
export const MAX_ZIP_PATH_BYTES = 1024

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const digestPattern = /^[a-f0-9]{64}$/
const payloadPathPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

function fail(message) {
  throw new Error(`Invalid SlothVault knowledge package: ${message}`)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertRecord(value, label) {
  if (!isRecord(value)) fail(`${label} must be an object`)
  return value
}

function assertArray(value, label, minimum, maximum) {
  if (!Array.isArray(value)) fail(`${label} must be an array`)
  if (value.length < minimum || value.length > maximum) {
    fail(`${label} must contain ${minimum} to ${maximum} items`)
  }
  return value
}

function assertExactKeys(value, label, keys) {
  const actualKeys = Object.keys(assertRecord(value, label)).sort()
  const expectedKeys = [...keys].sort()
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    fail(`${label} must contain exactly: ${expectedKeys.join(', ')}`)
  }
}

function assertString(value, label, {
  minimum = 0,
  maximum,
  trim = true,
  pattern,
  nonBlank = false,
} = {}) {
  if (typeof value !== 'string') fail(`${label} must be a string`)
  if (trim && value !== value.trim()) fail(`${label} cannot have leading or trailing whitespace`)
  if (value.length < minimum || (maximum !== undefined && value.length > maximum)) {
    fail(`${label} must contain ${minimum} to ${maximum ?? 'unbounded'} characters`)
  }
  if (nonBlank && value.trim().length === 0) fail(`${label} cannot be blank`)
  if (pattern && !pattern.test(value)) fail(`${label} has an invalid format`)
  return value
}

function assertInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) fail(`${label} must be unique`)
}

function assertRelativeSourcePath(value, label) {
  assertString(value, label, { minimum: 1, maximum: 1024, pattern: /\S/ })
  if (
    value.includes('\0')
    || value.includes('\\')
    || value.startsWith('/')
    || isAbsolute(value)
    || win32.isAbsolute(value)
    || /^[A-Za-z]:/.test(value)
  ) {
    fail(`${label} must be a relative POSIX source path`)
  }

  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    fail(`${label} cannot contain empty, dot, or parent-directory segments`)
  }
  return value
}

function assertSourceReference(value, label) {
  const sourceReference = assertRecord(value, label)
  const allowedKeys = new Set(['path', 'symbol', 'kind', 'note'])
  if (!Object.keys(sourceReference).includes('path') || Object.keys(sourceReference).some((key) => !allowedKeys.has(key))) {
    fail(`${label} must contain path and only optional symbol, kind, or note fields`)
  }
  assertRelativeSourcePath(value.path, `${label}.path`)
  if ('symbol' in value) assertString(value.symbol, `${label}.symbol`, { minimum: 1, maximum: 512 })
  if ('kind' in value) assertString(value.kind, `${label}.kind`, { minimum: 1, maximum: 64 })
  if ('note' in value) assertString(value.note, `${label}.note`, { minimum: 1, maximum: 1000 })
}

function assertArticle(value, label) {
  assertExactKeys(value, label, [
    'id',
    'title',
    'slug',
    'summary',
    'articleType',
    'tags',
    'order',
    'sourceReferences',
    'content',
  ])
  assertString(value.id, `${label}.id`, { minimum: 1, maximum: 128, pattern: safeIdPattern })
  assertString(value.title, `${label}.title`, { minimum: 1, maximum: 255 })
  assertString(value.slug, `${label}.slug`, { minimum: 1, maximum: 160, pattern: slugPattern })
  assertString(value.summary, `${label}.summary`, { maximum: 2000 })
  assertString(value.articleType, `${label}.articleType`, { minimum: 1, maximum: 64 })
  const tags = assertArray(value.tags, `${label}.tags`, 0, 30)
  for (const [index, tag] of tags.entries()) {
    assertString(tag, `${label}.tags[${index}]`, { minimum: 1, maximum: 64 })
  }
  assertUnique(tags, `${label}.tags`)
  assertInteger(value.order, `${label}.order`, 0, 1_000_000)

  const sourceReferences = assertArray(value.sourceReferences, `${label}.sourceReferences`, 1, 500)
  for (const [index, sourceReference] of sourceReferences.entries()) {
    assertSourceReference(sourceReference, `${label}.sourceReferences[${index}]`)
  }

  assertString(value.content, `${label}.content`, {
    minimum: 1,
    maximum: MAX_ARTICLE_CHARACTERS,
    trim: false,
    nonBlank: true,
  })
  if (Buffer.byteLength(value.content, 'utf8') > MAX_ARTICLE_UTF8_BYTES) {
    fail(`${label}.content exceeds ${MAX_ARTICLE_UTF8_BYTES} UTF-8 bytes`)
  }
}

export function validateKnowledgeBase(value, { kind } = {}) {
  if (kind !== undefined && kind !== 'project' && kind !== 'article') {
    fail('package kind must be project or article')
  }

  assertExactKeys(value, 'knowledge-base.json', ['project', 'knowledgeBase', 'categories'])
  assertExactKeys(value.project, 'project', ['name', 'description'])
  assertString(value.project.name, 'project.name', { minimum: 1, maximum: 128 })
  assertString(value.project.description, 'project.description', { maximum: 2000 })

  assertExactKeys(value.knowledgeBase, 'knowledgeBase', ['title', 'summary'])
  assertString(value.knowledgeBase.title, 'knowledgeBase.title', { minimum: 1, maximum: 255 })
  assertString(value.knowledgeBase.summary, 'knowledgeBase.summary', { maximum: 2000 })

  const categories = assertArray(value.categories, 'categories', 1, MAX_CATEGORIES)
  let articleCount = 0
  const categoryIds = []
  const categoryOrders = []
  const articleIds = []
  const articleSlugs = []

  for (const [categoryIndex, category] of categories.entries()) {
    const categoryLabel = `categories[${categoryIndex}]`
    assertExactKeys(category, categoryLabel, ['id', 'title', 'order', 'articles'])
    assertString(category.id, `${categoryLabel}.id`, { minimum: 1, maximum: 128, pattern: safeIdPattern })
    assertString(category.title, `${categoryLabel}.title`, { minimum: 1, maximum: 64 })
    assertInteger(category.order, `${categoryLabel}.order`, 0, 1_000_000)
    const articles = assertArray(category.articles, `${categoryLabel}.articles`, 1, MAX_ARTICLES_PER_CATEGORY)
    const articleOrders = []
    for (const [articleIndex, article] of articles.entries()) {
      assertArticle(article, `${categoryLabel}.articles[${articleIndex}]`)
      articleCount += 1
      articleIds.push(article.id)
      articleSlugs.push(article.slug)
      articleOrders.push(article.order)
    }
    assertUnique(articleOrders, `${categoryLabel}.article order values`)
    categoryIds.push(category.id)
    categoryOrders.push(category.order)
  }

  if (articleCount > MAX_ARTICLES) fail(`articles must contain at most ${MAX_ARTICLES} items`)
  assertUnique(categoryIds, 'category ids')
  assertUnique(categoryOrders, 'category order values')
  assertUnique(articleIds, 'article ids')
  assertUnique(articleSlugs, 'article slugs')
  if (kind === 'article' && (categories.length !== 1 || articleCount !== 1)) {
    fail('article packages must contain exactly one category and one article')
  }

  return value
}

export function expectedPayloadPaths(knowledgeBase) {
  return [
    'knowledge-base.json',
    ...knowledgeBase.categories.flatMap((category) =>
      category.articles.map((article) => `articles/${article.slug}.md`),
    ),
  ]
}

export function createPayloadEntries(knowledgeBase) {
  const knowledgeBaseBytes = Buffer.from(`${JSON.stringify(knowledgeBase, null, 2)}\n`, 'utf8')
  if (knowledgeBaseBytes.length > MAX_KNOWLEDGE_JSON_BYTES) {
    fail(`knowledge-base.json exceeds ${MAX_KNOWLEDGE_JSON_BYTES} bytes`)
  }

  const articleEntries = knowledgeBase.categories
    .flatMap((category) => category.articles)
    .map((article) => ({
      name: `articles/${article.slug}.md`,
      bytes: Buffer.from(article.content, 'utf8'),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
  const payloadEntries = [
    { name: 'knowledge-base.json', bytes: knowledgeBaseBytes },
    ...articleEntries,
  ]
  const totalBytes = payloadEntries.reduce((total, entry) => total + entry.bytes.length, 0)
  if (totalBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
    fail(`package payloads exceed ${MAX_ZIP_UNCOMPRESSED_BYTES} uncompressed bytes`)
  }
  return payloadEntries
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function assertCreatedAt(value) {
  assertString(value, 'manifest.createdAt', { minimum: 1, maximum: 64 })
  if (!isoDateTimePattern.test(value) || Number.isNaN(Date.parse(value))) {
    fail('manifest.createdAt must be an ISO-8601 UTC datetime')
  }
}

export function validateManifest(value, knowledgeBase, { expectedKind } = {}) {
  assertExactKeys(value, 'manifest.json', ['format', 'schemaVersion', 'kind', 'createdAt', 'payloads'])
  if (value.format !== PACKAGE_FORMAT) fail(`manifest.format must be ${PACKAGE_FORMAT}`)
  if (value.schemaVersion !== PACKAGE_SCHEMA_VERSION) fail(`manifest.schemaVersion must be ${PACKAGE_SCHEMA_VERSION}`)
  if (value.kind !== 'project' && value.kind !== 'article') fail('manifest.kind must be project or article')
  if (expectedKind !== undefined && value.kind !== expectedKind) fail(`manifest.kind must be ${expectedKind}`)
  assertCreatedAt(value.createdAt)

  const expectedPaths = expectedPayloadPaths(knowledgeBase)
  const payloads = assertArray(value.payloads, 'manifest.payloads', 1, MAX_ARTICLES + 1)
  const payloadPaths = []
  for (const [index, payload] of payloads.entries()) {
    const label = `manifest.payloads[${index}]`
    assertExactKeys(payload, label, ['path', 'sha256', 'bytes'])
    assertString(payload.path, `${label}.path`, { minimum: 1, maximum: 1024, pattern: payloadPathPattern })
    assertString(payload.sha256, `${label}.sha256`, { minimum: 64, maximum: 64, pattern: digestPattern })
    assertInteger(payload.bytes, `${label}.bytes`, 1, MAX_KNOWLEDGE_JSON_BYTES)
    payloadPaths.push(payload.path)
  }
  assertUnique(payloadPaths, 'manifest payload paths')
  if (payloads.length !== expectedPaths.length || expectedPaths.some((path) => !payloadPaths.includes(path))) {
    fail('manifest.payloads must declare exactly knowledge-base.json and every article Markdown mirror')
  }
  return value
}

function isInside(rootPath, candidatePath) {
  const value = relative(rootPath, candidatePath)
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value))
}

export async function validateSourceReferencePaths(knowledgeBase, sourceRoot) {
  if (typeof sourceRoot !== 'string' || !sourceRoot.trim()) {
    fail('source root is required to verify sourceReferences')
  }

  const requestedRoot = resolve(sourceRoot)
  let canonicalRoot
  try {
    const rootStats = await stat(requestedRoot)
    if (!rootStats.isDirectory()) fail(`source root is not a directory: ${requestedRoot}`)
    canonicalRoot = await realpath(requestedRoot)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid SlothVault knowledge package:')) throw error
    fail(`source root cannot be read: ${requestedRoot}`)
  }

  for (const category of knowledgeBase.categories) {
    for (const article of category.articles) {
      for (const sourceReference of article.sourceReferences) {
        const candidatePath = resolve(canonicalRoot, ...sourceReference.path.split('/'))
        if (!isInside(canonicalRoot, candidatePath)) {
          fail(`source reference escapes source root: ${sourceReference.path}`)
        }

        let canonicalFile
        try {
          canonicalFile = await realpath(candidatePath)
          const fileStats = await stat(canonicalFile)
          if (!fileStats.isFile()) fail(`source reference is not a regular file: ${sourceReference.path}`)
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Invalid SlothVault knowledge package:')) throw error
          fail(`source reference does not resolve to a readable file: ${sourceReference.path}`)
        }
        if (!isInside(canonicalRoot, canonicalFile)) {
          fail(`source reference resolves outside source root: ${sourceReference.path}`)
        }
      }
    }
  }
}

function assertZipSignature(bytes) {
  if (bytes.length < 4) fail('ZIP archive is too small')
  const signature = bytes.readUInt32LE(0)
  if (signature !== 0x04034b50 && signature !== 0x06054b50) fail('invalid ZIP signature')
}

function zipEntryKind(entry) {
  if (entry.type === 'File') return 'file'
  if (entry.type === 'Directory') return 'directory'
  fail('ZIP contains an unsupported entry type')
}

function validateZipPath(entry, kind) {
  const rawPath = entry.path
  if (
    !rawPath
    || rawPath.includes('\0')
    || rawPath.includes('\\')
    || rawPath.includes('\uFFFD')
    || rawPath.startsWith('/')
    || isAbsolute(rawPath)
    || win32.isAbsolute(rawPath)
    || /^[A-Za-z]:/.test(rawPath)
    || Buffer.byteLength(rawPath, 'utf8') > MAX_ZIP_PATH_BYTES
  ) {
    fail('ZIP contains an unsafe path')
  }
  const segments = rawPath.split('/')
  if (kind === 'directory' && segments.at(-1) === '') segments.pop()
  if (
    segments.length === 0
    || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))
  ) {
    fail('ZIP contains an unsafe path')
  }
  if (kind === 'file' && rawPath.endsWith('/')) fail('ZIP file entry has a directory path')
  return segments
}

function assertRegularZipEntry(entry, kind) {
  if ((entry.flags & 0x01) !== 0) fail('encrypted ZIP entries are not supported')
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    fail('ZIP uses an unsupported compression method')
  }
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  const unixFileType = unixMode & 0o170000
  const regularFile = 0o100000
  const directory = 0o040000
  if (unixFileType !== 0 && unixFileType !== regularFile && unixFileType !== directory) {
    fail('ZIP contains a symlink or special entry')
  }
  if (
    (kind === 'file' && unixFileType === directory)
    || (kind === 'directory' && unixFileType === regularFile)
  ) {
    fail('ZIP entry type metadata is inconsistent')
  }
}

async function inspectZipArchive(archiveBytes) {
  if (!Buffer.isBuffer(archiveBytes) || archiveBytes.length === 0 || archiveBytes.length > MAX_ZIP_BYTES) {
    fail(`ZIP archive must contain 1 to ${MAX_ZIP_BYTES} bytes`)
  }
  assertZipSignature(archiveBytes)

  let directory
  try {
    directory = await unzipper.Open.buffer(archiveBytes)
  } catch {
    fail('invalid ZIP archive')
  }
  if (
    directory.diskNumber !== 0
    || directory.diskStart !== 0
    || directory.numberOfRecordsOnDisk !== directory.numberOfRecords
    || directory.files.length !== directory.numberOfRecords
    || directory.files.length > MAX_ZIP_ENTRIES
  ) {
    fail('multi-disk or oversized ZIP archives are not supported')
  }

  const normalizedPaths = new Map()
  const files = new Map()
  const directories = new Set()
  const entries = []
  let declaredTotal = 0
  for (const entry of directory.files) {
    const kind = zipEntryKind(entry)
    assertRegularZipEntry(entry, kind)
    const segments = validateZipPath(entry, kind)
    const relativePath = segments.join('/')
    const normalizedPath = relativePath.toLocaleLowerCase('en-US')
    if (normalizedPaths.has(normalizedPath)) fail('ZIP contains duplicate paths')
    if (
      !Number.isSafeInteger(entry.uncompressedSize)
      || entry.uncompressedSize < 0
      || !Number.isSafeInteger(entry.compressedSize)
      || entry.compressedSize < 0
      || entry.compressedSize > MAX_ZIP_BYTES
    ) {
      fail('ZIP contains an invalid entry size')
    }
    if (kind === 'directory' && entry.uncompressedSize !== 0) fail('ZIP directory entry has content')
    if (entry.uncompressedSize > MAX_ZIP_ENTRY_BYTES) fail('ZIP entry exceeds the size limit')

    declaredTotal += entry.uncompressedSize
    if (declaredTotal > MAX_ZIP_UNCOMPRESSED_BYTES) fail('ZIP exceeds the total uncompressed size limit')
    normalizedPaths.set(normalizedPath, kind)
    if (kind === 'file') files.set(relativePath, entry)
    else directories.add(relativePath)
    entries.push({ segments, relativePath })
  }

  for (const entry of entries) {
    for (let index = 1; index < entry.segments.length; index += 1) {
      const parentPath = entry.segments.slice(0, index).join('/').toLocaleLowerCase('en-US')
      if (normalizedPaths.get(parentPath) === 'file') fail('ZIP contains a file/directory path conflict')
    }
  }
  return { files, directories }
}

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    fail(`${label} must be valid UTF-8`)
  }
}

function parseJson(bytes, label) {
  const text = decodeUtf8(bytes, label)
  try {
    return JSON.parse(text)
  } catch {
    fail(`${label} must be valid JSON`)
  }
}

async function readArchiveFile(files, path, maximumBytes) {
  const entry = files.get(path)
  if (!entry) fail(`ZIP is missing ${path}`)
  if (entry.uncompressedSize > maximumBytes) fail(`${path} exceeds ${maximumBytes} bytes`)
  let bytes
  try {
    bytes = await entry.buffer()
  } catch {
    fail(`cannot read ZIP entry: ${path}`)
  }
  if (bytes.length !== entry.uncompressedSize || bytes.length > maximumBytes) {
    fail(`ZIP entry size mismatch: ${path}`)
  }
  return bytes
}

export async function validateKnowledgePackageArchive(archiveBytes, {
  expectedKind,
  sourceRoot,
} = {}) {
  const { files, directories } = await inspectZipArchive(archiveBytes)
  const manifestBytes = await readArchiveFile(files, 'manifest.json', MAX_MANIFEST_BYTES)
  const knowledgeBaseBytes = await readArchiveFile(files, 'knowledge-base.json', MAX_KNOWLEDGE_JSON_BYTES)
  const manifest = parseJson(manifestBytes, 'manifest.json')
  const knowledgeBase = parseJson(knowledgeBaseBytes, 'knowledge-base.json')
  validateKnowledgeBase(knowledgeBase, { kind: expectedKind })
  validateManifest(manifest, knowledgeBase, { expectedKind })
  if (manifest.kind !== expectedKind && expectedKind !== undefined) fail(`manifest.kind must be ${expectedKind}`)
  if (manifest.kind === 'article') validateKnowledgeBase(knowledgeBase, { kind: 'article' })
  if (sourceRoot !== undefined) await validateSourceReferencePaths(knowledgeBase, sourceRoot)

  const expectedPayloads = expectedPayloadPaths(knowledgeBase)
  const expectedFiles = new Set(['manifest.json', ...expectedPayloads])
  if (
    files.size !== expectedFiles.size
    || [...files.keys()].some((path) => !expectedFiles.has(path))
    || [...directories].some((path) => path !== 'articles')
  ) {
    fail('ZIP contains undocumented files or directories')
  }

  for (const path of expectedPayloads) {
    const maximumBytes = path === 'knowledge-base.json' ? MAX_KNOWLEDGE_JSON_BYTES : MAX_ARTICLE_UTF8_BYTES
    const payloadBytes = await readArchiveFile(files, path, maximumBytes)
    const payload = manifest.payloads.find((item) => item.path === path)
    if (!payload || payload.bytes !== payloadBytes.length || payload.sha256 !== sha256(payloadBytes)) {
      fail(`payload digest mismatch: ${path}`)
    }
    if (path !== 'knowledge-base.json') {
      const article = knowledgeBase.categories
        .flatMap((category) => category.articles)
        .find((item) => `articles/${item.slug}.md` === path)
      if (!article || decodeUtf8(payloadBytes, path) !== article.content) {
        fail(`Markdown mirror mismatch: ${path}`)
      }
    }
  }

  return { manifest, knowledgeBase }
}
