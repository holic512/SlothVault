import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { sqliteDatabaseFilePath } from '@/server/database/connection-url'
import {
  hasInitializedApplicationSchema,
  inspectPendingDatabaseConnection,
} from '@/server/database/connection-test'

const originalAppDataPath = process.env.APP_DATA_PATH
const temporaryDirectories: string[] = []

afterEach(() => {
  if (originalAppDataPath === undefined) delete process.env.APP_DATA_PATH
  else process.env.APP_DATA_PATH = originalAppDataPath
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('pending installation reset guard', () => {
  it('requires the fixed initial Prisma migration to be marked finished', async () => {
    const path = mkdtempSync(join(tmpdir(), 'slothvault-migration-state-'))
    temporaryDirectories.push(path)
    process.env.APP_DATA_PATH = path
    mkdirSync(join(path, 'database'), { recursive: true })

    const database = new Database(sqliteDatabaseFilePath())
    database.exec(`
      CREATE TABLE system_installation (id INTEGER PRIMARY KEY);
      CREATE TABLE _prisma_migrations (
        migration_name TEXT NOT NULL,
        finished_at DATETIME,
        rolled_back_at DATETIME
      );
      INSERT INTO _prisma_migrations (migration_name, finished_at, rolled_back_at)
      VALUES ('20260719000000_initial', NULL, NULL);
    `)
    database.close()

    await expect(
      hasInitializedApplicationSchema({ provider: 'sqlite', config: {} }),
    ).resolves.toBe(false)
    await expect(
      inspectPendingDatabaseConnection({ provider: 'sqlite', config: {} }),
    ).resolves.toMatchObject({ reachable: true, empty: false, schemaReady: false })

    const completedDatabase = new Database(sqliteDatabaseFilePath())
    completedDatabase.prepare(`
      UPDATE _prisma_migrations
      SET finished_at = ?
      WHERE migration_name = '20260719000000_initial'
    `).run(new Date().toISOString())
    completedDatabase.close()

    await expect(
      hasInitializedApplicationSchema({ provider: 'sqlite', config: {} }),
    ).resolves.toBe(true)
    await expect(
      inspectPendingDatabaseConnection({ provider: 'sqlite', config: {} }),
    ).resolves.toMatchObject({ reachable: true, empty: false, schemaReady: true })
  })
})
