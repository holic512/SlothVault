/**
 * @file homepage-cover.ts
 * @project SlothVault
 * @module Homepage Cover Settings
 * @description Persists optional homepage covers and resolves only active, readable static images for public rendering.
 * @logic Validate bounded configuration and managed image bytes before atomically saving settings and references; public failures omit the cover.
 * @dependencies Prisma SystemConfig/FileManagement models, homepage cover contract, managed file references, sharp
 * @index_tags homepage,cover,uploads,config,transaction,public
 * @author holic512
 */
import 'server-only'

import { readFile, stat } from 'node:fs/promises'
import sharp from 'sharp'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { parseHomepageCover, readHomepageCover, type HomepageCover } from '@/lib/homepage-cover'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { unitOfWork } from '@/server/database/unit-of-work'
import { GENERAL_FILE_MAX_BYTES, resolveStoredUploadPath } from './admin-files'
import { assertManagedContentFiles, syncFileReferences } from './file-references'
import { CONFIG_KEYS } from './system-config'

function isAnimatedPng(buffer: Buffer) {
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    if (buffer.toString('ascii', offset + 4, offset + 8) === 'acTL') return true
    offset += length + 12
  }
  return false
}

async function assertCoverImage(reader: Prisma.TransactionClient, cover: HomepageCover, decode = false) {
  if (!cover.filePath) return
  await assertManagedContentFiles(reader, undefined, [`/${cover.filePath}`])
  const path = resolveStoredUploadPath(cover.filePath)
  if ((await stat(path)).size > GENERAL_FILE_MAX_BYTES) throw new HttpError('Homepage cover exceeds 10MB', 400, 400)
  if (!decode) return
  try {
    const buffer = await readFile(path)
    const options = { animated: true, failOn: 'warning' as const, limitInputPixels: 40_000_000 }
    const image = sharp(buffer, options)
    const metadata = await image.metadata()
    const extension = cover.filePath.split('.').pop()!.toLowerCase()
    if (metadata.format !== (extension === 'jpg' ? 'jpeg' : extension) || (metadata.pages ?? 1) !== 1 ||
        (metadata.format === 'png' && isAnimatedPng(buffer))) throw new Error('Invalid static image')
    await image.toBuffer()
  } catch {
    throw new HttpError('Homepage cover must be a static JPG, PNG or WebP image', 400, 400)
  }
}

export async function getHomepageCoverSettings(): Promise<HomepageCover> {
  const config = await prisma.systemConfig.findUnique({
    where: { configKey: CONFIG_KEYS.SYSTEM_HOMEPAGE_COVER },
    select: { configValue: true },
  })
  return readHomepageCover(config?.configValue)
}

export async function saveHomepageCoverSettings(input: unknown): Promise<HomepageCover> {
  const cover = parseHomepageCover(input)
  if (!cover) throw new HttpError('Invalid homepage cover settings', 400, 400)
  return unitOfWork.execute(async tx => {
    await assertCoverImage(tx, cover, true)
    const config = await tx.systemConfig.upsert({
      where: { configKey: CONFIG_KEYS.SYSTEM_HOMEPAGE_COVER },
      create: {
        configKey: CONFIG_KEYS.SYSTEM_HOMEPAGE_COVER,
        configValue: JSON.stringify(cover),
        description: 'Optional public homepage cover',
      },
      update: { configValue: JSON.stringify(cover), updatedAt: new Date() },
    })
    await syncFileReferences(tx, 'SYSTEM_CONFIG', config.id)
    return cover
  }, { timeout: 15_000 })
}

export async function getPublicHomepageCover(): Promise<HomepageCover | null> {
  try {
    const cover = await getHomepageCoverSettings()
    if (!cover.enabled) return null
    await assertCoverImage(prisma, cover)
    return cover
  } catch { return null }
}
