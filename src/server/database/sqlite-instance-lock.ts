/**
 * @file sqlite-instance-lock.ts
 * @project SlothVault
 * @module Database Runtime
 * @description Enforces the supported single-instance deployment contract for the managed SQLite database file.
 * @logic Atomically create a tokenized lock file, refresh it while the process lives, recover stale locks, and remove only the lock owned by this process.
 * @dependencies node:fs, node:crypto, database/connection-url
 * @index_tags sqlite,single-instance,lock,runtime
 * @author holic512
 */
import 'server-only'

import { randomUUID } from 'node:crypto'
import {
  closeSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'

import { sqliteDatabaseFilePath } from '@/server/database/connection-url'

const SQLITE_LOCK_STALE_MS = 30_000

const globalSqliteLock = globalThis as unknown as {
  slothVaultSqliteLock?: { token: string; heartbeat: NodeJS.Timeout }
}

export class SqliteInstanceLockError extends Error {
  constructor() {
    super('SQLite mode supports only one SlothVault server instance')
    this.name = 'SqliteInstanceLockError'
  }
}

function sqliteLockPath() {
  return `${sqliteDatabaseFilePath()}.instance.lock`
}

function removeOwnedLock(path: string, token: string) {
  try {
    const stored = JSON.parse(readFileSync(path, 'utf8')) as { token?: string }
    if (stored.token === token) rmSync(path, { force: true })
  } catch {
    // A missing or replaced lock is no longer owned by this process.
  }
}

export function acquireSqliteInstanceLock() {
  if (globalSqliteLock.slothVaultSqliteLock) return

  const path = sqliteLockPath()
  const token = randomUUID()
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = openSync(path, 'wx', 0o600)
      try {
        writeFileSync(
          descriptor,
          JSON.stringify({ token, pid: process.pid, startedAt: new Date().toISOString() }),
          'utf8',
        )
      } finally {
        closeSync(descriptor)
      }
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let stale = false
      try {
        stale = Date.now() - statSync(path).mtimeMs > SQLITE_LOCK_STALE_MS
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw statError
      }
      if (stale && attempt === 0) {
        rmSync(path, { force: true })
        continue
      }
      throw new SqliteInstanceLockError()
    }
  }

  const heartbeat = setInterval(() => {
    try {
      const now = new Date()
      utimesSync(path, now, now)
    } catch {
      // The next database operation will surface an actual storage failure.
    }
  }, 5_000)
  heartbeat.unref()
  globalSqliteLock.slothVaultSqliteLock = { token, heartbeat }

  const cleanup = () => {
    const current = globalSqliteLock.slothVaultSqliteLock
    if (!current || current.token !== token) return
    clearInterval(current.heartbeat)
    removeOwnedLock(path, token)
    globalSqliteLock.slothVaultSqliteLock = undefined
  }
  process.once('exit', cleanup)
}
