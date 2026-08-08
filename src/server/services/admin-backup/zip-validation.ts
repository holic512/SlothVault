/**
 * @file zip-validation.ts
 * @project SlothVault
 * @module Admin Files Backup ZIP Validation
 * @description Preflights and validates imported ZIP archives before any upload-root mutation.
 * @logic Reject unsafe paths, ZIP64 and multi-disk archives, special entries, duplicate paths, unsupported compression, oversized data, and corrupt checksums.
 * @dependencies Unzipper, Node path APIs, server/http/errors, backup ZIP limits
 * @index_tags admin,backup,files,zip,validation,security
 * @author holic512
 */
import 'server-only'

import {
  isAbsolute,
  win32,
} from 'node:path'

import unzipper, { type File as ZipEntry } from 'unzipper'

import { HttpError } from '@/server/http/errors'

import {
  ZIP_ENTRY_LIMIT,
  ZIP_ENTRY_MAX_BYTES,
  ZIP_FILE_MAX_BYTES,
  ZIP_PATH_MAX_BYTES,
  ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES,
} from './constants'
import { nodeErrorHasCode } from './files-common'

export type ValidatedZipEntry = {
  entry: ZipEntry
  segments: string[]
  relativePath: string
  kind: 'directory' | 'file'
  declaredSize: number
}

function isZipSignature(buffer: Buffer) {
  if (buffer.length < 4) return false
  const signature = buffer.readUInt32LE(0)
  return signature === 0x04034b50 || signature === 0x06054b50
}

function preflightZipCentralDirectory(buffer: Buffer) {
  const minimumOffset = Math.max(0, buffer.length - (65_535 + 22))
  let endOffset = -1
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (
      buffer.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length
    ) {
      endOffset = offset
      break
    }
  }
  if (endOffset < 0) throw new HttpError('Invalid ZIP archive', 400, 400)

  const diskNumber = buffer.readUInt16LE(endOffset + 4)
  const diskStart = buffer.readUInt16LE(endOffset + 6)
  const recordsOnDisk = buffer.readUInt16LE(endOffset + 8)
  const numberOfRecords = buffer.readUInt16LE(endOffset + 10)
  const centralSize = buffer.readUInt32LE(endOffset + 12)
  const centralOffset = buffer.readUInt32LE(endOffset + 16)
  const commentLength = buffer.readUInt16LE(endOffset + 20)

  if (endOffset + 22 + commentLength !== buffer.length) {
    throw new HttpError('Invalid ZIP end record', 400, 400)
  }
  if (
    diskNumber !== 0 ||
    diskStart !== 0 ||
    recordsOnDisk !== numberOfRecords
  ) {
    throw new HttpError('Multi-disk ZIP archives are not supported', 400, 400)
  }
  if (
    numberOfRecords === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new HttpError('ZIP64 archives are not supported', 400, 400)
  }
  if (numberOfRecords > ZIP_ENTRY_LIMIT) {
    throw new HttpError(`ZIP entry count exceeds ${ZIP_ENTRY_LIMIT}`, 400, 400)
  }
  if (centralOffset + centralSize > endOffset) {
    throw new HttpError('Invalid ZIP central directory bounds', 400, 400)
  }

  return { numberOfRecords, centralSize, centralOffset }
}

function zipEntryKind(entry: ZipEntry): 'directory' | 'file' {
  if (entry.type === 'Directory') return 'directory'
  if (entry.type === 'File') return 'file'
  throw new HttpError('ZIP contains an unsupported entry type', 400, 400)
}

function validateZipEntryPath(entry: ZipEntry, kind: 'directory' | 'file') {
  const rawPath = entry.path
  if (
    !rawPath ||
    rawPath.includes('\0') ||
    rawPath.includes('\\') ||
    rawPath.includes('\uFFFD') ||
    rawPath.startsWith('/') ||
    isAbsolute(rawPath) ||
    win32.isAbsolute(rawPath) ||
    /^[A-Za-z]:/.test(rawPath) ||
    Buffer.byteLength(rawPath, 'utf8') > ZIP_PATH_MAX_BYTES
  ) {
    throw new HttpError('ZIP contains an unsafe path', 400, 400)
  }

  const segments = rawPath.split('/')
  if (kind === 'directory' && segments.at(-1) === '') segments.pop()
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        !segment || segment === '.' || segment === '..' || segment.startsWith('.'),
    )
  ) {
    throw new HttpError('ZIP contains an unsafe path', 400, 400)
  }
  if (kind === 'file' && rawPath.endsWith('/')) {
    throw new HttpError('ZIP file entry has a directory path', 400, 400)
  }
  return segments
}

function assertRegularZipEntry(entry: ZipEntry, kind: 'directory' | 'file') {
  if ((entry.flags & 0x01) !== 0) {
    throw new HttpError('Encrypted ZIP entries are not supported', 400, 400)
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new HttpError('ZIP uses an unsupported compression method', 400, 400)
  }

  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  const unixFileType = unixMode & 0o170000
  const regularFile = 0o100000
  const directory = 0o040000
  if (
    unixFileType !== 0 &&
    unixFileType !== regularFile &&
    unixFileType !== directory
  ) {
    throw new HttpError('ZIP contains a symlink or special entry', 400, 400)
  }
  if (
    (kind === 'file' && unixFileType === directory) ||
    (kind === 'directory' && unixFileType === regularFile)
  ) {
    throw new HttpError('ZIP entry type metadata is inconsistent', 400, 400)
  }
}

export async function validateZipArchive(buffer: Buffer) {
  if (!isZipSignature(buffer)) {
    throw new HttpError('Invalid ZIP archive', 400, 400)
  }
  const preflight = preflightZipCentralDirectory(buffer)

  let directory: Awaited<ReturnType<typeof unzipper.Open.buffer>>
  try {
    directory = await unzipper.Open.buffer(buffer)
  } catch {
    throw new HttpError('Invalid ZIP archive', 400, 400)
  }

  if (
    directory.diskNumber !== 0 ||
    directory.diskStart !== 0 ||
    directory.numberOfRecordsOnDisk !== directory.numberOfRecords ||
    directory.files.length !== directory.numberOfRecords ||
    directory.numberOfRecords !== preflight.numberOfRecords ||
    directory.sizeOfCentralDirectory !== preflight.centralSize ||
    directory.offsetToStartOfCentralDirectory !== preflight.centralOffset
  ) {
    throw new HttpError('Multi-disk or inconsistent ZIP archives are not supported', 400, 400)
  }
  if (directory.files.length > ZIP_ENTRY_LIMIT) {
    throw new HttpError(`ZIP entry count exceeds ${ZIP_ENTRY_LIMIT}`, 400, 400)
  }

  const entries: ValidatedZipEntry[] = []
  const normalizedPaths = new Map<string, 'directory' | 'file'>()
  let declaredTotal = 0

  for (const entry of directory.files) {
    const kind = zipEntryKind(entry)
    assertRegularZipEntry(entry, kind)
    const segments = validateZipEntryPath(entry, kind)
    const relativePath = segments.join('/')
    const normalizedKey = relativePath.toLocaleLowerCase('en-US')
    if (normalizedPaths.has(normalizedKey)) {
      throw new HttpError('ZIP contains duplicate paths', 400, 400)
    }

    if (
      !Number.isSafeInteger(entry.uncompressedSize) ||
      entry.uncompressedSize < 0 ||
      !Number.isSafeInteger(entry.compressedSize) ||
      entry.compressedSize < 0 ||
      entry.compressedSize > ZIP_FILE_MAX_BYTES
    ) {
      throw new HttpError('ZIP contains an invalid entry size', 400, 400)
    }
    if (kind === 'directory' && entry.uncompressedSize !== 0) {
      throw new HttpError('ZIP directory entry has content', 400, 400)
    }
    if (entry.uncompressedSize > ZIP_ENTRY_MAX_BYTES) {
      throw new HttpError('ZIP entry exceeds the size limit', 400, 400)
    }

    declaredTotal += entry.uncompressedSize
    if (declaredTotal > ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES) {
      throw new HttpError('ZIP exceeds the total uncompressed size limit', 400, 400)
    }

    normalizedPaths.set(normalizedKey, kind)
    entries.push({
      entry,
      segments,
      relativePath,
      kind,
      declaredSize: entry.uncompressedSize,
    })
  }

  for (const item of entries) {
    for (let index = 1; index < item.segments.length; index += 1) {
      const parentKey = item.segments
        .slice(0, index)
        .join('/')
        .toLocaleLowerCase('en-US')
      if (normalizedPaths.get(parentKey) === 'file') {
        throw new HttpError('ZIP contains a file/directory path conflict', 400, 400)
      }
    }
  }
  return entries
}

const CRC32_TABLE = Array.from({ length: 256 }, (_value, index) => {
  let current = index
  for (let bit = 0; bit < 8; bit += 1) {
    current = (current & 1) !== 0 ? 0xedb88320 ^ (current >>> 1) : current >>> 1
  }
  return current >>> 0
})

export function updateCrc32(current: number, chunk: Buffer) {
  let crc = current
  for (const byte of chunk) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return crc >>> 0
}

export function isFileSystemFailure(error: unknown) {
  return [
    'EACCES',
    'EDQUOT',
    'EIO',
    'EMFILE',
    'ENFILE',
    'ENOSPC',
    'EROFS',
  ].some((code) => nodeErrorHasCode(error, code))
}
