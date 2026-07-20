/**
 * @file instrumentation-node.ts
 * @project SlothVault
 * @module Server Bootstrap
 * @description Initializes private application storage and the installed SQLite runtime in the Node.js server process.
 * @logic Persist the master key before serving traffic, tolerate unreadable configuration as maintenance state, and instantiate SQLite early so a competing server process fails before readiness.
 * @dependencies master-key, database/config-store, database/client
 * @index_tags nodejs,startup,master-key,sqlite,single-instance
 * @author holic512
 */
import 'server-only'

import { getMasterKey } from '@/server/config/master-key'
import {
  DatabaseConfigurationError,
  readDatabaseConfiguration,
} from '@/server/database/config-store'
import { getDatabaseClient } from '@/server/database/client'
import { SqliteInstanceLockError } from '@/server/database/sqlite-instance-lock'

export async function initializeNodeRuntime() {
  getMasterKey()

  let configuration
  try {
    configuration = readDatabaseConfiguration()
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) return
    throw error
  }

  if (
    configuration?.provider === 'sqlite' &&
    configuration.status !== 'CONFIGURING'
  ) {
    try {
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
