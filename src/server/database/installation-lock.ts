/**
 * @file installation-lock.ts
 * @project SlothVault
 * @module Database Bootstrap
 * @description Serializes first-install mutations across requests and server processes sharing the application data volume.
 * @logic Combine a process promise queue with an atomic private lock file, refresh its timestamp while held, and recover only clearly stale locks.
 * @dependencies node:fs, app-data, server/http/errors
 * @index_tags installer,lock,concurrency,bootstrap
 * @author holic512
 */
import 'server-only'

import {
  closeSync,
  openSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'

import { appConfigPath, ensureAppDataDirectories } from '@/server/config/app-data'
import { HttpError } from '@/server/http/errors'

const STALE_LOCK_MS = 10 * 60 * 1000

const globalInstallLock = globalThis as unknown as {
  slothVaultInstallQueue?: Promise<void>
}

function lockPath() {
  return resolve(appConfigPath(), 'installation.lock')
}

function acquireFileLock() {
  ensureAppDataDirectories()
  const path = lockPath()

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = openSync(path, 'wx', 0o600)
      writeFileSync(
        descriptor,
        JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
        'utf8',
      )
      return { descriptor, path }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let stale = false
      try {
        stale = Date.now() - statSync(path).mtimeMs > STALE_LOCK_MS
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw statError
      }
      if (stale && attempt === 0) {
        rmSync(path, { force: true })
        continue
      }
      throw new HttpError('System installation is already running', 409, 409)
    }
  }

  throw new HttpError('System installation is already running', 409, 409)
}

export async function withInstallationLock<T>(operation: () => Promise<T>) {
  const previous = globalInstallLock.slothVaultInstallQueue ?? Promise.resolve()
  let releaseQueue: (() => void) | undefined
  const current = new Promise<void>((resolveQueue) => {
    releaseQueue = resolveQueue
  })
  const tail = previous.then(() => current)
  globalInstallLock.slothVaultInstallQueue = tail
  await previous

  const lock = acquireFileLock()
  const heartbeat = setInterval(() => {
    try {
      const now = new Date()
      utimesSync(lock.path, now, now)
    } catch {
      // The guarded operation remains authoritative; cleanup reports the filesystem error later.
    }
  }, 5_000)
  heartbeat.unref()

  try {
    return await operation()
  } finally {
    clearInterval(heartbeat)
    closeSync(lock.descriptor)
    rmSync(lock.path, { force: true })
    releaseQueue?.()
    if (globalInstallLock.slothVaultInstallQueue === tail) {
      globalInstallLock.slothVaultInstallQueue = undefined
    }
  }
}
