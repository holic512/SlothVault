/**
 * @file markdown-thumbnail.ts
 * @project SlothVault
 * @module Markdown Image Derivatives
 * @description Caches bounded first-frame WebP previews outside durable upload storage.
 * @logic Consume already authorized upload metadata, reuse cached derivatives, serialize image work through the upload capacity gate, coalesce identical work, and atomically publish regenerable files.
 * @dependencies sharp, admin-files, node filesystem and temporary directory
 * @index_tags markdown,images,thumbnail,cache,sharp
 * @author holic512
 */
import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

import { readPublicUpload, UPLOAD_ROOT, withImageValidationCapacity, type inspectPublicUpload } from './admin-files'

const TRANSFORM_VERSION = 'webp-first-frame-1280-q80-v1'
const projectKey = createHash('sha256').update(UPLOAD_ROOT).digest('hex').slice(0, 24)
export const MARKDOWN_THUMBNAIL_CACHE_ROOT = join(tmpdir(), 'slothvault-markdown-thumbnails', projectKey)
type Source = Awaited<ReturnType<typeof inspectPublicUpload>>
type CachedThumbnail = { path: string; size: number }
const pending = new Map<string, Promise<CachedThumbnail>>()

/** The caller must authorize the source on every request, including cache hits. */
export async function readMarkdownThumbnail(source: Source, headOnly = false) {
  const key = createHash('sha256').update(JSON.stringify([
    source.absolutePath, source.stats.size, source.stats.mtimeMs, TRANSFORM_VERSION,
  ])).digest('hex')
  const path = join(MARKDOWN_THUMBNAIL_CACHE_ROOT, `${key}.webp`)
  const cached = await cachedThumbnail(path)
  const thumbnail = cached ?? await generateOnce(key, path, source)
  return {
    size: thumbnail.size,
    buffer: headOnly ? undefined : await readFile(thumbnail.path),
  }
}

async function cachedThumbnail(path: string): Promise<CachedThumbnail | undefined> {
  try {
    const info = await stat(path)
    if (info.isFile() && info.size > 0) return { path, size: info.size }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function generateOnce(key: string, path: string, source: Source) {
  const existing = pending.get(key)
  if (existing) return existing
  const work = withImageValidationCapacity(async () => {
    const cached = await cachedThumbnail(path)
    if (cached) return cached
    const original = await readPublicUpload(source.absolutePath)
    const buffer = await sharp(original, { animated: false, limitInputPixels: 40_000_000, failOn: 'warning' })
      .rotate()
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()
    await mkdir(MARKDOWN_THUMBNAIL_CACHE_ROOT, { recursive: true, mode: 0o700 })
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, buffer, { mode: 0o600, flag: 'wx' })
      await rename(temporary, path)
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
    return { path, size: buffer.length }
  }).finally(() => { pending.delete(key) })
  pending.set(key, work)
  return work
}
