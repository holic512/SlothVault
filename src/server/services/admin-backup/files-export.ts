/**
 * @file files-export.ts
 * @project SlothVault
 * @module Admin Files Backup Export
 * @description Builds a deterministic ZIP stream from regular visible files under the controlled upload root.
 * @logic Walk contained upload paths, skip symlinks and hidden entries, enforce path limits, and append stable archive entries.
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

import { ZIP_PATH_MAX_BYTES } from './constants'
import {
  assertContained,
  nodeErrorHasCode,
  toArchivePath,
  type StorageTreeEntry,
} from './files-common'

async function collectExportEntries(
  currentDirectory: string,
  result: StorageTreeEntry[],
) {
  const entries = await readdir(currentDirectory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.name.includes('\0') || entry.name.includes('\\')) {
      throw new Error('Uploads contain an unsupported file name')
    }

    const absolutePath = assertContained(
      UPLOAD_ROOT,
      resolve(currentDirectory, entry.name),
    )
    const stats = await lstat(absolutePath)
    if (stats.isSymbolicLink()) continue

    const relativePath = toArchivePath(UPLOAD_ROOT, absolutePath)
    if (Buffer.byteLength(relativePath, 'utf8') > ZIP_PATH_MAX_BYTES) {
      throw new Error('Uploads contain a path that is too long to back up')
    }

    if (stats.isDirectory()) {
      result.push({ absolutePath, relativePath, kind: 'directory' })
      await collectExportEntries(absolutePath, result)
    } else if (stats.isFile()) {
      result.push({ absolutePath, relativePath, kind: 'file' })
    }
  }
}

export async function createFilesExportArchive() {
  const entries: StorageTreeEntry[] = []
  try {
    await collectExportEntries(UPLOAD_ROOT, entries)
  } catch (error) {
    if (!nodeErrorHasCode(error, 'ENOENT')) throw error
  }

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
