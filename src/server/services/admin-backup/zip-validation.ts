/**
 * @file zip-validation.ts
 * @project SlothVault
 * @module Admin Files Backup ZIP Validation
 * @description Preflights and validates imported ZIP archives before any upload-root mutation.
 * @logic Validate ZIP32/ZIP64 central-directory bounds, contained regular entries, supported compression, declared lengths and checksums without aggregate capacity limits.
 * @dependencies Unzipper, Node path APIs, server/http/errors, backup ZIP limits
 * @index_tags admin,backup,files,zip,validation,security
 * @author holic512
 */
import 'server-only'
import { open, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { crc32 } from 'node:zlib'

import {
  isAbsolute,
  win32,
} from 'node:path'

import unzipper, { type File as ZipEntry } from 'unzipper'

import { HttpError } from '@/server/http/errors'

import {
  ZIP_PATH_MAX_BYTES,
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

function preflightZipCentralDirectory(buffer: Buffer, baseOffset = 0) {
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
  if (centralOffset + centralSize > endOffset + baseOffset) {
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

  return validateZipDirectory(directory, preflight)
}

export async function validateZipFile(path: string, maxBytes = Infinity) {
  const size = (await stat(path)).size
  if (size > maxBytes) throw new HttpError('ZIP file exceeds the size limit', 413, 413)
  if (size < 22) throw new HttpError('Invalid ZIP archive', 400, 400)
  const handle = await open(path, 'r')
  let tail: Buffer
  let baseOffset: number
  try {
    const signature = Buffer.alloc(4)
    await handle.read(signature, 0, 4, 0)
    if (!isZipSignature(signature)) throw new HttpError('Invalid ZIP archive', 400, 400)
    baseOffset = Math.max(0, size - 65_557)
    tail = Buffer.alloc(size - baseOffset)
    const read = await handle.read(tail, 0, tail.length, baseOffset)
    if (read.bytesRead !== tail.length) throw new HttpError('Invalid ZIP archive', 400, 400)
  } finally { await handle.close() }
  const preflight = await preflightZipFile(path, tail, baseOffset)
  let directory: Awaited<ReturnType<typeof unzipper.Open.file>>
  // Unzipper 0.12.5 computes the ZIP64 locator from its current tail chunk's match offset.
  // Supplying the already bounded tail in one chunk avoids offsets drifting at the 64 KiB read boundary.
  const source = { size: async () => size, stream: (start: number, length?: number) => start === baseOffset && length === undefined
    ? Readable.from([tail])
    : createReadStream(path, { start, ...(length ? { end: start + length - 1 } : {}) }) }
  try { directory = await (unzipper.Open.custom as (input: typeof source, options: {tailSize: number}) => ReturnType<typeof unzipper.Open.custom>)(source, { tailSize: tail.length }) }
  catch { throw new HttpError('Invalid ZIP archive', 400, 400) }
  return validateZipDirectory(directory, preflight)
}

async function preflightZipFile(path: string, tail: Buffer, baseOffset: number) {
  let end = -1
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break }
  if (end < 0) throw new HttpError('Invalid ZIP archive', 400, 400)
  const count = tail.readUInt16LE(end + 10), size = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16)
  if (count !== 0xffff && size !== 0xffffffff && offset !== 0xffffffff) return preflightZipCentralDirectory(tail, baseOffset)
  const handle = await open(path, 'r')
  const safe = (buffer: Buffer, position: number) => { const n = buffer.readBigUInt64LE(position); if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new HttpError('ZIP value exceeds runtime precision', 400, 400); return Number(n) }
  const read = async (position: number, bytes: number) => { if (position < 0 || position + bytes > baseOffset + tail.length) throw new HttpError('Invalid ZIP64 bounds', 400, 400); const b = Buffer.alloc(bytes); if ((await handle.read(b, 0, bytes, position)).bytesRead !== bytes) throw new HttpError('Invalid ZIP64 record', 400, 400); return b }
  try {
    if (tail.readUInt16LE(end + 4) !== 0 || tail.readUInt16LE(end + 6) !== 0 || tail.readUInt16LE(end + 8) !== count) throw new HttpError('Multi-disk ZIP is unsupported', 400, 400)
    const locator = await read(baseOffset + end - 20, 20)
    if (locator.readUInt32LE(0) !== 0x07064b50 || locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) !== 1) throw new HttpError('Invalid ZIP64 locator', 400, 400)
    const position = safe(locator, 8), record = await read(position, 56)
    const recordSize = safe(record, 4), numberOfRecords = safe(record, 32), centralSize = safe(record, 40), centralOffset = safe(record, 48)
    if (record.readUInt32LE(0) !== 0x06064b50 || recordSize < 44 || position + 12 + recordSize !== baseOffset + end - 20 || record.readUInt32LE(16) !== 0 || record.readUInt32LE(20) !== 0 || safe(record, 24) !== numberOfRecords || centralOffset + centralSize !== position) throw new HttpError('Invalid ZIP64 central directory', 400, 400)
    return { numberOfRecords, centralSize, centralOffset }
  } finally { await handle.close() }
}

function validateZipDirectory(directory: Awaited<ReturnType<typeof unzipper.Open.buffer>>, preflight: ReturnType<typeof preflightZipCentralDirectory>) {
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

  const entries: ValidatedZipEntry[] = []
  const normalizedPaths = new Map<string, 'directory' | 'file'>()

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
      entry.compressedSize < 0
    ) {
      throw new HttpError('ZIP contains an invalid entry size', 400, 400)
    }
    if (kind === 'directory' && entry.uncompressedSize !== 0) {
      throw new HttpError('ZIP directory entry has content', 400, 400)
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

export function updateCrc32(current: number, chunk: Buffer) {
  // Callers carry the unfinalized CRC; Node's native implementation carries the finalized CRC.
  return (crc32(chunk, (current ^ 0xffffffff) >>> 0) ^ 0xffffffff) >>> 0
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
