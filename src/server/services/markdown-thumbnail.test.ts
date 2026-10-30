import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ read: vi.fn(), capacity: vi.fn() }))
vi.mock('./admin-files', () => ({
  UPLOAD_ROOT: `/tmp/sv-markdown-thumbnail-test-${process.pid}-${Date.now()}`,
  readPublicUpload: mocks.read,
  withImageValidationCapacity: mocks.capacity,
}))
import { MARKDOWN_THUMBNAIL_CACHE_ROOT, readMarkdownThumbnail } from './markdown-thumbnail'

let root: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'sv-thumbnail-source-'))
  mocks.read.mockImplementation(readFile)
  mocks.capacity.mockImplementation((operation: () => Promise<unknown>) => operation())
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(MARKDOWN_THUMBNAIL_CACHE_ROOT, { recursive: true, force: true })
})

async function source(name: string, buffer: Buffer) {
  const path = join(root, name)
  await writeFile(path, buffer)
  return { absolutePath: path, fileName: name, stats: await stat(path), contentType: 'image/png', attachment: false }
}

describe('Markdown thumbnail derivatives', () => {
  it('caps the longest edge, preserves aspect ratio and coalesces cold generation', async () => {
    const image = await source('large.png', await sharp({ create: { width: 2400, height: 1600, channels: 4, background: '#426388' } }).png().toBuffer())
    mocks.read.mockClear()
    mocks.capacity.mockClear()
    const coldStarted = performance.now()
    const [first, second] = await Promise.all([readMarkdownThumbnail(image), readMarkdownThumbnail(image)])
    const coldMs = performance.now() - coldStarted
    expect(first.buffer).toEqual(second.buffer)
    expect(mocks.read).toHaveBeenCalledOnce()
    expect(mocks.capacity).toHaveBeenCalledOnce()
    expect(await sharp(first.buffer!).metadata()).toMatchObject({ format: 'webp', width: 1280, height: 853 })
    mocks.read.mockClear()
    const hotStarted = performance.now()
    const hot = await readMarkdownThumbnail(image)
    process.stdout.write(`[markdown-thumbnail-benchmark] ${JSON.stringify({ originalBytes: image.stats.size, thumbnailBytes: first.size, coldMs: Number(coldMs.toFixed(2)), hotMs: Number((performance.now() - hotStarted).toFixed(2)) })}\n`)
    expect(hot.buffer).toEqual(first.buffer)
    expect(mocks.read).not.toHaveBeenCalled()
    expect((await readdir(MARKDOWN_THUMBNAIL_CACHE_ROOT)).filter(name => name.endsWith('.tmp'))).toEqual([])
    const head = await readMarkdownThumbnail(image, true)
    expect(head).toEqual({ size: first.size, buffer: undefined })
  })

  it('does not enlarge small images and invalidates when the source changes', async () => {
    const original = await source('small.png', await sharp({ create: { width: 12, height: 8, channels: 3, background: '#ff0000' } }).png().toBuffer())
    const first = await readMarkdownThumbnail(original)
    expect(await sharp(first.buffer!).metadata()).toMatchObject({ width: 12, height: 8 })
    const changed = await source('small.png', await sharp({ create: { width: 13, height: 9, channels: 3, background: '#0000ff' } }).png().toBuffer())
    const second = await readMarkdownThumbnail(changed)
    expect(second.buffer).not.toEqual(first.buffer)
    expect(await sharp(second.buffer!).metadata()).toMatchObject({ width: 13, height: 9 })
  })

  it('uses the first frame of animated input', async () => {
    const pixels = Buffer.from([255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255])
    const animation = await sharp(pixels, { raw: { width: 2, height: 2, channels: 3, pageHeight: 1 } }).webp({ delay: [100, 100], loop: 0 }).toBuffer()
    expect((await sharp(animation, { animated: true }).metadata()).pages).toBe(2)
    const result = await readMarkdownThumbnail(await source('animated.webp', animation))
    const metadata = await sharp(result.buffer!, { animated: true }).metadata()
    expect(metadata).toMatchObject({ width: 2, height: 1 })
    expect(metadata.pages ?? 1).toBe(1)
  })

  it('rejects corrupt sources without leaving a cache entry or stuck work', async () => {
    const corrupt = await source('corrupt.png', Buffer.from('not an image'))
    const count = (await readdir(MARKDOWN_THUMBNAIL_CACHE_ROOT)).length
    await expect(readMarkdownThumbnail(corrupt)).rejects.toThrow()
    await expect(readMarkdownThumbnail(corrupt)).rejects.toThrow()
    expect((await readdir(MARKDOWN_THUMBNAIL_CACHE_ROOT)).length).toBe(count)
  })
})
