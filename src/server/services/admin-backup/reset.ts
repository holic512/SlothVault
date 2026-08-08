/**
 * @file reset.ts
 * @project SlothVault
 * @module Admin System Reset
 * @description Coordinates optional database deletion and controlled upload reset with filesystem rollback.
 * @logic Stage visible uploads, recreate standard directories, delete database records transactionally, and restore staged files if database reset fails.
 * @dependencies database unit-of-work, Node filesystem APIs, admin upload root, backup deletion and file safety
 * @index_tags admin,backup,reset,database,files,rollback
 * @author holic512
 */
import 'server-only'

import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  rename,
  rm,
} from 'node:fs/promises'

import { unitOfWork } from '@/server/database/unit-of-work'
import { UPLOAD_ROOT } from '@/server/services/admin-files'

import {
  DATABASE_TRANSACTION_MAX_WAIT_MS,
  DATABASE_TRANSACTION_TIMEOUT_MS,
  STANDARD_RESET_DIRECTORIES,
} from './constants'
import { deleteBusinessData } from './database-delete'
import {
  countVisiblePath,
  ensureUploadRoot,
  removePathBestEffort,
  resolveWithin,
  restoreRootEntries,
  visibleRootNames,
} from './files-common'

async function stageVisibleUploads(prefix: string) {
  await ensureUploadRoot()
  const rollbackDirectory = resolveWithin(UPLOAD_ROOT, `${prefix}${randomUUID()}`)
  await mkdir(rollbackDirectory)
  let names: string[] = []
  let filesDeleted = 0
  let dirsDeleted = 0
  const moved: string[] = []
  try {
    names = await visibleRootNames()
    for (const name of names) {
      const source = resolveWithin(UPLOAD_ROOT, name)
      const stats = await lstat(source)
      filesDeleted += await countVisiblePath(source)
      if (stats.isDirectory() && !stats.isSymbolicLink()) dirsDeleted += 1
    }

    for (const name of names) {
      await rename(
        resolveWithin(UPLOAD_ROOT, name),
        resolveWithin(rollbackDirectory, name),
      )
      moved.push(name)
    }
  } catch (error) {
    let restored = false
    try {
      await restoreRootEntries(rollbackDirectory, moved)
      restored = true
    } catch (restoreError) {
      console.error('[backup] Failed to restore reset staging', restoreError)
    }
    if (restored) {
      await removePathBestEffort(rollbackDirectory, 'failed reset staging directory')
    }
    throw error
  }

  return { rollbackDirectory, names: moved, filesDeleted, dirsDeleted }
}

async function createResetDirectories() {
  const created: string[] = []
  try {
    for (const name of STANDARD_RESET_DIRECTORIES) {
      const directory = resolveWithin(UPLOAD_ROOT, name)
      await mkdir(directory)
      created.push(directory)
    }
    return created
  } catch (error) {
    await removeResetDirectories(created)
    throw error
  }
}

async function removeResetDirectories(directories: string[]) {
  for (const directory of directories.toReversed()) {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function resetSystem(options: {
  clearDatabase: boolean
  clearFiles: boolean
}) {
  let stagedFiles:
    | Awaited<ReturnType<typeof stageVisibleUploads>>
    | null = null
  let resetDirectories: string[] = []

  if (options.clearFiles) {
    stagedFiles = await stageVisibleUploads('.reset-rollback-')
    try {
      resetDirectories = await createResetDirectories()
    } catch (error) {
      await removeResetDirectories(resetDirectories)
      await restoreRootEntries(stagedFiles.rollbackDirectory, stagedFiles.names)
      await removePathBestEffort(
        stagedFiles.rollbackDirectory,
        'failed system-reset rollback directory',
      )
      throw error
    }
  }

  let databaseResult: Awaited<ReturnType<typeof deleteBusinessData>> | null = null
  try {
    if (options.clearDatabase) {
      databaseResult = await unitOfWork.execute(
        (tx) => deleteBusinessData(tx),
        {
          maxWait: DATABASE_TRANSACTION_MAX_WAIT_MS,
          timeout: DATABASE_TRANSACTION_TIMEOUT_MS,
        },
      )
    }
  } catch (error) {
    if (stagedFiles) {
      try {
        await removeResetDirectories(resetDirectories)
      } catch (cleanupError) {
        console.error('[backup] Failed to remove reset directories before restore', cleanupError)
      }
      let restored = false
      try {
        await restoreRootEntries(stagedFiles.rollbackDirectory, stagedFiles.names)
        restored = true
      } catch (restoreError) {
        console.error(
          '[backup] Failed to restore files after database reset failure',
          restoreError,
        )
      }
      if (restored) {
        await removePathBestEffort(
          stagedFiles.rollbackDirectory,
          'restored system-reset rollback directory',
        )
      }
    }
    throw error
  }

  if (stagedFiles) {
    void removePathBestEffort(stagedFiles.rollbackDirectory, 'system-reset rollback directory')
  }

  return {
    message: 'System reset completed successfully',
    database: databaseResult
      ? { success: true as const, ...databaseResult }
      : null,
    files: stagedFiles
      ? {
          success: true as const,
          filesDeleted: stagedFiles.filesDeleted,
          dirsDeleted: stagedFiles.dirsDeleted,
          standardDirsRecreated: [...STANDARD_RESET_DIRECTORIES],
        }
      : null,
  }
}
