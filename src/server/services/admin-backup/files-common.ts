/**
 * @file files-common.ts
 * @project SlothVault
 * @module Admin Backup File Safety
 * @description Provides contained upload-root path operations and shared filesystem traversal and rollback helpers.
 * @logic Resolve only paths inside the upload root, reject special staging entries, enumerate visible content, and restore moved root entries safely.
 * @dependencies Node filesystem and path APIs, server/http/errors, admin upload root
 * @index_tags admin,backup,files,path,containment,rollback
 * @author holic512
 */
import 'server-only'

import {
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises'
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path'

import { HttpError } from '@/server/http/errors'
import { UPLOAD_ROOT } from '@/server/services/admin-files'

export function nodeErrorHasCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}

export type StorageTreeEntry = {
  absolutePath: string
  relativePath: string
  kind: 'directory' | 'file'
}

export function assertContained(root: string, candidate: string) {
  const relativePath = relative(root, candidate)
  const isWithinRoot =
    relativePath === '' ||
    (!isAbsolute(relativePath) &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`))
  if (!isWithinRoot) throw new HttpError('Access denied', 403, 403)
  return candidate
}

export function resolveWithin(root: string, ...segments: string[]) {
  return assertContained(root, resolve(root, ...segments))
}

export function relativePathSegments(relativePath: string) {
  return relativePath.split('/').filter(Boolean)
}

export function toArchivePath(root: string, absolutePath: string) {
  const relativePath = relative(root, assertContained(root, absolutePath))
  return relativePath.split(sep).join('/')
}

export async function ensureUploadRoot() {
  await mkdir(UPLOAD_ROOT, { recursive: true })
  return realpath(UPLOAD_ROOT)
}

export async function removePathBestEffort(path: string, label: string) {
  try {
    await rm(assertContained(UPLOAD_ROOT, path), { recursive: true, force: true })
  } catch (error) {
    console.error(`[backup] Failed to clean ${label}`, error)
  }
}

export async function collectStorageTree(
  root: string,
  currentDirectory = root,
  result: StorageTreeEntry[] = [],
) {
  const entries = await readdir(currentDirectory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    const absolutePath = resolveWithin(root, ...relative(root, resolve(currentDirectory, entry.name)).split(sep))
    const stats = await lstat(absolutePath)
    if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
      throw new Error('Staging contains a non-regular entry')
    }
    const relativePath = toArchivePath(root, absolutePath)
    const kind = stats.isDirectory() ? 'directory' : 'file'
    result.push({ absolutePath, relativePath, kind })
    if (kind === 'directory') await collectStorageTree(root, absolutePath, result)
  }
  return result
}

export async function lstatOrNull(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if (nodeErrorHasCode(error, 'ENOENT')) return null
    throw error
  }
}

export async function restoreRootEntries(
  sourceDirectory: string,
  names: string[],
) {
  let firstError: unknown = null
  for (const name of names.toReversed()) {
    try {
      const source = resolveWithin(sourceDirectory, name)
      const destination = resolveWithin(UPLOAD_ROOT, name)
      if (!(await lstatOrNull(source))) continue
      if (await lstatOrNull(destination)) {
        throw new Error(`Cannot restore ${name}: destination already exists`)
      }
      await rename(source, destination)
    } catch (error) {
      firstError ??= error
      console.error(`[backup] Failed to restore root entry ${name}`, error)
    }
  }
  if (firstError) throw firstError
}

export async function visibleRootNames() {
  const entries = await readdir(UPLOAD_ROOT, { withFileTypes: true })
  return entries
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
}

export async function countVisiblePath(path: string): Promise<number> {
  const stats = await lstat(path)
  if (!stats.isDirectory() || stats.isSymbolicLink()) return 1
  const entries = await readdir(path, { withFileTypes: true })
  let count = 0
  for (const entry of entries) {
    count += await countVisiblePath(resolveWithin(UPLOAD_ROOT, ...relative(UPLOAD_ROOT, resolve(path, entry.name)).split(sep)))
  }
  return count
}
