/**
 * @file files-import.ts
 * @project SlothVault
 * @module Admin Files Backup Import
 * @description Stages, verifies, and atomically commits upload ZIP archives in insert or overwrite mode.
 * @logic Extract bounded regular entries with CRC checks, detect conflicts, commit by links or root moves, and compensate partial filesystem changes.
 * @dependencies Node filesystem and stream APIs, admin upload root, backup file safety, ZIP validation
 * @index_tags admin,backup,files,import,zip,staging,rollback
 * @author holic512
 */
import 'server-only'

import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  link,
  mkdir,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises'
import { dirname } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { HttpError } from '@/server/http/errors'
import { UPLOAD_ROOT } from '@/server/services/admin-files'

import {
  ZIP_ENTRY_MAX_BYTES,
  ZIP_FILE_MAX_BYTES,
  ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES,
  type ImportMode,
} from './constants'
import {
  assertContained,
  collectStorageTree,
  ensureUploadRoot,
  lstatOrNull,
  nodeErrorHasCode,
  relativePathSegments,
  removePathBestEffort,
  resolveWithin,
  restoreRootEntries,
  visibleRootNames,
} from './files-common'
import {
  isFileSystemFailure,
  updateCrc32,
  validateZipArchive,
  type ValidatedZipEntry,
} from './zip-validation'

async function createStagingDirectory(prefix: string) {
  const realUploadRoot = await ensureUploadRoot()
  const stagingDirectory = resolveWithin(UPLOAD_ROOT, `${prefix}${randomUUID()}`)
  await mkdir(stagingDirectory)
  const realStagingDirectory = await realpath(stagingDirectory)
  assertContained(realUploadRoot, realStagingDirectory)
  return stagingDirectory
}

async function extractZipToStaging(entries: ValidatedZipEntry[], stagingDirectory: string) {
  let actualTotal = 0
  let filesImported = 0

  for (const item of entries) {
    const targetPath = resolveWithin(stagingDirectory, ...item.segments)
    if (item.kind === 'directory') {
      await mkdir(targetPath, { recursive: true })
      continue
    }

    await mkdir(dirname(targetPath), { recursive: true })
    let entryBytes = 0
    let crc = 0xffffffff
    const limiter = new Transform({
      transform(chunk: Buffer | string, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        entryBytes += buffer.length
        actualTotal += buffer.length
        if (entryBytes > ZIP_ENTRY_MAX_BYTES) {
          callback(new HttpError('ZIP entry exceeds the size limit', 400, 400))
          return
        }
        if (actualTotal > ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES) {
          callback(new HttpError('ZIP exceeds the total uncompressed size limit', 400, 400))
          return
        }
        crc = updateCrc32(crc, buffer)
        callback(null, buffer)
      },
    })

    try {
      await pipeline(
        item.entry.stream(),
        limiter,
        createWriteStream(targetPath, { flags: 'wx', mode: 0o600 }),
      )
    } catch (error) {
      if (error instanceof HttpError || isFileSystemFailure(error)) throw error
      throw new HttpError('Invalid or corrupted ZIP archive', 400, 400)
    }

    const checksum = (crc ^ 0xffffffff) >>> 0
    if (entryBytes !== item.declaredSize || checksum !== (item.entry.crc32 >>> 0)) {
      throw new HttpError('ZIP entry size or checksum mismatch', 400, 400)
    }
    filesImported += 1
  }
  return filesImported
}

async function rollbackInsertedFiles(
  linkedFiles: Array<{ source: string; destination: string }>,
  createdDirectories: string[],
) {
  for (const item of linkedFiles.toReversed()) {
    try {
      if (!(await lstatOrNull(item.source)) && (await lstatOrNull(item.destination))) {
        await link(item.destination, item.source)
      }
      await unlink(item.destination).catch((error) => {
        if (!nodeErrorHasCode(error, 'ENOENT')) throw error
      })
    } catch (error) {
      console.error('[backup] Failed to roll back inserted file', error)
    }
  }
  for (const directory of createdDirectories.toReversed()) {
    try {
      await rmdir(directory)
    } catch (error) {
      if (!nodeErrorHasCode(error, 'ENOENT') && !nodeErrorHasCode(error, 'ENOTEMPTY')) {
        console.error('[backup] Failed to remove inserted directory during rollback', error)
      }
    }
  }
}

async function commitInsert(stagingDirectory: string) {
  const entries = await collectStorageTree(stagingDirectory)
  const directories = entries
    .filter((entry) => entry.kind === 'directory')
    .sort(
      (left, right) =>
        relativePathSegments(left.relativePath).length -
        relativePathSegments(right.relativePath).length,
    )
  const files = entries.filter((entry) => entry.kind === 'file')

  for (const entry of directories) {
    const destination = resolveWithin(
      UPLOAD_ROOT,
      ...relativePathSegments(entry.relativePath),
    )
    const existing = await lstatOrNull(destination)
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
      throw new HttpError(`File conflict: ${entry.relativePath}`, 409, 409)
    }
  }
  for (const entry of files) {
    const destination = resolveWithin(
      UPLOAD_ROOT,
      ...relativePathSegments(entry.relativePath),
    )
    if (await lstatOrNull(destination)) {
      throw new HttpError(`File conflict: ${entry.relativePath}`, 409, 409)
    }
  }

  const createdDirectories: string[] = []
  const linkedFiles: Array<{ source: string; destination: string }> = []
  try {
    for (const entry of directories) {
      const destination = resolveWithin(
        UPLOAD_ROOT,
        ...relativePathSegments(entry.relativePath),
      )
      if (!(await lstatOrNull(destination))) {
        await mkdir(destination)
        createdDirectories.push(destination)
      }
    }

    for (const entry of files) {
      const destination = resolveWithin(
        UPLOAD_ROOT,
        ...relativePathSegments(entry.relativePath),
      )
      await link(entry.absolutePath, destination)
      linkedFiles.push({ source: entry.absolutePath, destination })
      await unlink(entry.absolutePath)
    }
  } catch (error) {
    await rollbackInsertedFiles(linkedFiles, createdDirectories)
    throw error
  }

  await removePathBestEffort(stagingDirectory, 'files-import staging directory')
}

async function commitOverwrite(stagingDirectory: string) {
  await ensureUploadRoot()
  const rollbackDirectory = resolveWithin(
    UPLOAD_ROOT,
    `.backup-rollback-${randomUUID()}`,
  )
  await mkdir(rollbackDirectory)
  let previousNames: string[]
  let stagedNames: string[]
  try {
    previousNames = await visibleRootNames()
    stagedNames = (await readdir(stagingDirectory, { withFileTypes: true }))
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    await removePathBestEffort(rollbackDirectory, 'unused files-import rollback directory')
    throw error
  }
  const movedPrevious: string[] = []
  const committed: string[] = []

  try {
    for (const name of previousNames) {
      await rename(
        resolveWithin(UPLOAD_ROOT, name),
        resolveWithin(rollbackDirectory, name),
      )
      movedPrevious.push(name)
    }

    for (const name of stagedNames) {
      const destination = resolveWithin(UPLOAD_ROOT, name)
      if (await lstatOrNull(destination)) {
        throw new Error(`Cannot commit ${name}: destination already exists`)
      }
      await rename(
        resolveWithin(stagingDirectory, name),
        destination,
      )
      committed.push(name)
    }
  } catch (error) {
    for (const name of committed.toReversed()) {
      try {
        await rename(
          resolveWithin(UPLOAD_ROOT, name),
          resolveWithin(stagingDirectory, name),
        )
      } catch (restoreError) {
        console.error('[backup] Failed to move committed import back to staging', restoreError)
      }
    }
    let restored = false
    try {
      await restoreRootEntries(rollbackDirectory, movedPrevious)
      restored = true
    } catch (restoreError) {
      console.error('[backup] Failed to restore files-import rollback', restoreError)
    }
    if (restored) {
      await removePathBestEffort(
        rollbackDirectory,
        'restored files-import rollback directory',
      )
    }
    throw error
  }

  await removePathBestEffort(rollbackDirectory, 'files-import rollback directory')
  await removePathBestEffort(stagingDirectory, 'files-import staging directory')
}

export async function importFilesBackup(zipBuffer: Buffer, mode: ImportMode) {
  if (zipBuffer.length > ZIP_FILE_MAX_BYTES) {
    throw new HttpError('ZIP file exceeds the 250MB limit', 413, 413)
  }

  const entries = await validateZipArchive(zipBuffer)
  const stagingDirectory = await createStagingDirectory('.backup-staging-')
  let filesImported: number
  try {
    filesImported = await extractZipToStaging(entries, stagingDirectory)
    if (mode === 'overwrite') await commitOverwrite(stagingDirectory)
    else await commitInsert(stagingDirectory)
  } catch (error) {
    await removePathBestEffort(stagingDirectory, 'failed files-import staging directory')
    throw error
  }

  return {
    message: 'Files import completed successfully',
    mode,
    filesImported,
  }
}
