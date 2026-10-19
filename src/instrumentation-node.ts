/**
 * @file instrumentation-node.ts
 * @project SlothVault
 * @module Server Bootstrap
 * @description Initializes persistence, migrates the configured database, resolves interrupted restores, and registers local automatic backups before serving traffic.
 * @logic Persist the master key, bootstrap opt-in Compose storage, migrate and lock SQLite when needed, preserve unresolved restore evidence, and register isolated telemetry and one backup scheduler outside builds. Reconcile plugin schema switches before traffic, then register lazy plugin metadata and its scheduler without importing plugin code.
 * @dependencies master-key, database/compose-bootstrap, database/config-store, database/client, database/migrations, sqlite-instance-lock, backup scheduler, plugin recovery and manager
 * @index_tags nodejs,startup,migrations,master-key,sqlite,compose,single-instance,backup,recovery
 * @author holic512
 */
import 'server-only'
import { reconcilePluginRestore } from '@/server/plugins/backup'
import { initializePlugins } from '@/server/plugins/manager'
import { RESTORE_COMMIT_CONFIG_KEY } from '@/server/services/admin-backup/constants'
import { telemetryRuntime } from '@/server/telemetry/runtime'

import { initializeCommissionRuntime } from '@/server/commissions/scheduler'
import { getMasterKey } from '@/server/config/master-key'
import { initializeBackupRuntime } from '@/server/services/admin-backup/scheduler'
import {
  DatabaseConfigurationError,
  readDatabaseConfiguration,
} from '@/server/database/config-store'
import { bootstrapComposeDatabase } from '@/server/database/compose-bootstrap'
import { getDatabaseClient } from '@/server/database/client'
import { upgradeConfiguredDatabaseSchema } from '@/server/database/migrations'
import {
  acquireSqliteInstanceLock,
  SqliteInstanceLockError,
} from '@/server/database/sqlite-instance-lock'

export async function initializeNodeRuntime() {
  getMasterKey()
  telemetryRuntime()

  const composeBootstrap = await bootstrapComposeDatabase()
  if (composeBootstrap.enabled) {
    const action = composeBootstrap.initialized ? 'initialized' : 'verified'
    console.info(`[startup] Compose ${composeBootstrap.provider} database ${action}`)
  }

  let configuration
  try {
    configuration = readDatabaseConfiguration()
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) { await initializeBackupRuntime(); return }
    throw error
  }

  if (configuration && configuration.status !== 'CONFIGURING') {
    try {
      if (configuration.provider === 'sqlite') acquireSqliteInstanceLock()
      await upgradeConfiguredDatabaseSchema(configuration.connection)
      const client = getDatabaseClient()
      try {
        const restore = await client.systemConfig.findUnique({ where: { configKey: RESTORE_COMMIT_CONFIG_KEY }, select: { configValue: true } })
        await telemetryRuntime()?.reconcileSourceGeneration(restore?.configValue || 'initial')
      } catch { /* Telemetry reconciliation cannot make a healthy business runtime unavailable. */ }
    } catch (error) {
      if (error instanceof SqliteInstanceLockError) {
        console.error('[startup] SQLite instance lock is already held')
        process.exit(1)
      }
      throw error
    }
  }
  await initializeBackupRuntime()
  await reconcilePluginRestore()
  if (configuration && configuration.status !== 'CONFIGURING') {
    initializeCommissionRuntime()
    try { await initializePlugins() } catch { console.error('[plugins] Initialization failed; plugin administration requires attention') }
  }
}
