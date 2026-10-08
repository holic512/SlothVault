/**
 * @file files-export.ts
 * @project SlothVault
 * @module Admin Files Backup Export
 * @description Builds a deterministic ZIP stream from regular visible files under the controlled upload root.
 * @logic Walk contained upload paths, skip hidden runtime entries, reject symlinks or unrestoreable paths, enforce import-compatible limits, and append stable archive entries.
 * @dependencies Archiver, Node filesystem and path APIs, admin upload root, backup file safety
 * @index_tags admin,backup,files,export,zip,stream
 * @author holic512
 */
import 'server-only'

import {
  lstat,
  readdir,
} from 'node:fs/promises'
import { resolve } from 'node:path'

import archiver from 'archiver'

import { UPLOAD_ROOT } from '@/server/services/admin-files'
import { HttpError } from '@/server/http/errors'

import { ZIP_ENTRY_LIMIT, ZIP_ENTRY_MAX_BYTES, ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES, ZIP_PATH_MAX_BYTES, ZIP_FILE_MAX_BYTES } from './constants'
import { Transform } from 'node:stream'
import {
  assertContained,
  nodeErrorHasCode,
  toArchivePath,
  type StorageTreeEntry,
} from './files-common'

async function collectExportEntries(
  root: string,
  currentDirectory: string,
  result: StorageTreeEntry[],
) {
  const entries = await readdir(currentDirectory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.name.includes('\0') || entry.name.includes('\\') || entry.name.includes('\uFFFD')) {
      throw new HttpError('Uploads contain an unsupported file name', 409, 409)
    }

    const absolutePath = assertContained(
      root,
      resolve(currentDirectory, entry.name),
    )
    const stats = await lstat(absolutePath)
    if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) throw new HttpError('Uploads contain a symlink or special entry', 409, 409)

    const relativePath = toArchivePath(root, absolutePath)
    if (/^[A-Za-z]:/.test(relativePath) || Buffer.byteLength(relativePath + (stats.isDirectory() ? '/' : ''), 'utf8') > ZIP_PATH_MAX_BYTES) {
      throw new HttpError('Uploads contain a path that cannot be restored', 409, 409)
    }

    if (stats.isDirectory()) {
      result.push({ absolutePath, relativePath, kind: 'directory' })
      await collectExportEntries(root, absolutePath, result)
    } else if (stats.isFile()) {
      result.push({ absolutePath, relativePath, kind: 'file' })
    }
    if (result.length > ZIP_ENTRY_LIMIT) throw new HttpError('Uploads exceed backup entry limits', 413, 413)
  }
}

export async function collectFilesExportEntries(root = UPLOAD_ROOT) {
  const entries: StorageTreeEntry[] = []
  try {
    const info = await lstat(root)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new HttpError('Unsafe upload directory', 409, 409)
  } catch (error) {
    if (nodeErrorHasCode(error, 'ENOENT')) return entries
    throw error
  }
  await collectExportEntries(root, root, entries)
  const paths = new Set<string>()
  let total = 0
  for (const entry of entries) {
    const key = entry.relativePath.toLocaleLowerCase('en-US')
    if (paths.has(key)) throw new HttpError('Uploads contain duplicate archive paths', 409, 409)
    paths.add(key)
    if (entry.kind === 'file') {
      const size = (await lstat(entry.absolutePath)).size
      if (size > ZIP_ENTRY_MAX_BYTES) throw new HttpError('ZIP entry exceeds the size limit', 413, 413)
      total += size
    }
  }
  if (entries.length > ZIP_ENTRY_LIMIT || total > ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES) throw new HttpError('Uploads exceed backup limits', 413, 413)
  return entries
}

export async function createFilesExportArchive(root = UPLOAD_ROOT) {
  const entries = await collectFilesExportEntries(root)
  const archive = archiver('zip', { zlib: { level: 9 } })
  archive.on('warning', (error) => archive.destroy(error))

  for (const entry of entries) {
    if (entry.kind === 'directory') {
      archive.append('', { name: `${entry.relativePath}/` })
    } else {
      archive.file(entry.absolutePath, { name: entry.relativePath })
    }
  }
  return archive
}

export function archiveSizeLimiter(maxBytes = ZIP_FILE_MAX_BYTES) {
  let size = 0
  return new Transform({ transform(chunk: Buffer, _encoding, callback) {
    size += chunk.length
    if (size > maxBytes) callback(new HttpError('ZIP file exceeds the size limit', 413, 413))
    else callback(null, chunk)
  } })
}
