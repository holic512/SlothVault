/**
 * @file system-favicon.ts
 * @project SlothVault
 * @module System Favicon Processing
 * @description Validates administrator-supplied ICO files and builds multi-resolution ICO files from managed system logos.
 * @logic Verify every ICO directory entry is fully contained before persistence, then render transparent square PNG layers and pack them into one standards-compliant icon container.
 * @dependencies sharp, server/http/errors
 * @index_tags branding,favicon,ico,image-validation,sharp,upload-security
 * @author holic512
 */
import 'server-only'

import sharp from 'sharp'

import { HttpError } from '@/server/http/errors'

export const FAVICON_SIZES = [16, 32, 48, 64] as const

export type IcoEntry = {
  width: number
  height: number
  bytesInResource: number
  imageOffset: number
}

function icoError(message: string) {
  return new HttpError(message, 400, 400)
}

/**
 * Parses the ICO container directory without decoding embedded image data.
 * Bounds checks make this suitable for validating uploads before disk writes.
 */
export function inspectIcoBuffer(buffer: Buffer): IcoEntry[] {
  if (buffer.length < 6) throw icoError('Invalid ICO file')
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw icoError('Invalid ICO file')
  }

  const count = buffer.readUInt16LE(4)
  if (count === 0 || count > 64) throw icoError('Invalid ICO file')
  const directoryEnd = 6 + count * 16
  if (directoryEnd > buffer.length) throw icoError('Invalid ICO file')

  const entries: IcoEntry[] = []
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16
    const width = buffer.readUInt8(offset) || 256
    const height = buffer.readUInt8(offset + 1) || 256
    const bytesInResource = buffer.readUInt32LE(offset + 8)
    const imageOffset = buffer.readUInt32LE(offset + 12)
    if (
      bytesInResource === 0 ||
      imageOffset < directoryEnd ||
      imageOffset > buffer.length ||
      bytesInResource > buffer.length - imageOffset
    ) {
      throw icoError('Invalid ICO file')
    }
    entries.push({ width, height, bytesInResource, imageOffset })
  }
  return entries
}

export function validateSystemFaviconIco(buffer: Buffer, originalName: string) {
  try {
    inspectIcoBuffer(buffer)
  } catch (error) {
    if (error instanceof HttpError) {
      throw new HttpError(`Invalid favicon ICO file: ${originalName}`, 400, 400)
    }
    throw error
  }
}

function packIco(pngLayers: Array<{ size: number; png: Buffer }>) {
  const directorySize = 6 + pngLayers.length * 16
  const totalSize = directorySize + pngLayers.reduce((total, layer) => total + layer.png.length, 0)
  const ico = Buffer.alloc(totalSize)
  ico.writeUInt16LE(0, 0)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(pngLayers.length, 4)

  let dataOffset = directorySize
  pngLayers.forEach(({ size, png }, index) => {
    const entryOffset = 6 + index * 16
    ico.writeUInt8(size === 256 ? 0 : size, entryOffset)
    ico.writeUInt8(size === 256 ? 0 : size, entryOffset + 1)
    ico.writeUInt8(0, entryOffset + 2)
    ico.writeUInt8(0, entryOffset + 3)
    ico.writeUInt16LE(1, entryOffset + 4)
    ico.writeUInt16LE(32, entryOffset + 6)
    ico.writeUInt32LE(png.length, entryOffset + 8)
    ico.writeUInt32LE(dataOffset, entryOffset + 12)
    png.copy(ico, dataOffset)
    dataOffset += png.length
  })
  return ico
}

export async function createSystemFaviconIco(source: Buffer) {
  const pngLayers: Array<{ size: number; png: Buffer }> = []
  for (const size of FAVICON_SIZES) {
    pngLayers.push({
      size,
      png: await sharp(source, { animated: false, limitInputPixels: 40_000_000 })
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    })
  }
  const ico = packIco(pngLayers)
  inspectIcoBuffer(ico)
  return ico
}
