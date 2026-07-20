/**
 * @file instrumentation-node.ts
 * @project SlothVault
 * @module Server Bootstrap
 * @description Initializes private storage, applies committed database migrations, and starts the selected database runtime before serving traffic.
 * @logic Persist the master key, acquire the SQLite single-instance lock when needed, migrate every configured schema before Prisma queries, and fail startup on unsafe version drift.
 * @dependencies master-key, database/config-store, database/client, database/migrations, sqlite-instance-lock
 * @index_tags nodejs,startup,migrations,master-key,sqlite,single-instance
 * @author holic512
 */
import 'server-only'

import { getMasterKey } from '@/server/config/master-key'
import {
  DatabaseConfigurationError,
  readDatabaseConfiguration,
} from '@/server/database/config-store'
import { getDatabaseClient } from '@/server/database/client'
import { upgradeConfiguredDatabaseSchema } from '@/server/database/migrations'
import {
  acquireSqliteInstanceLock,
  SqliteInstanceLockError,
} from '@/server/database/sqlite-instance-lock'

export async function initializeNodeRuntime() {
  getMasterKey()

  let configuration
  try {
    configuration = readDatabaseConfiguration()
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) return
    throw error
  }

  if (configuration && configuration.status !== 'CONFIGURING') {
    try {
      if (configuration.provider === 'sqlite') acquireSqliteInstanceLock()
      await upgradeConfiguredDatabaseSchema(configuration.connection)
      getDatabaseClient()
    } catch (error) {
      if (error instanceof SqliteInstanceLockError) {
        console.error('[startup] SQLite instance lock is already held')
        process.exit(1)
      }
      throw error
    }
  }
}
