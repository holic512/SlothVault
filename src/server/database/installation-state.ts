/**
 * @file installation-state.ts
 * @project SlothVault
 * @module Database Bootstrap
 * @description Resolves the pre-database installation state used by request gates and the public installer status endpoint.
 * @logic Treat the encrypted local configuration as the bootstrap authority, expose only masked connection metadata, and convert unreadable installed configuration into maintenance state instead of reopening installation.
 * @dependencies database/config-store, database/types
 * @index_tags installer,status,gate,maintenance
 * @author holic512
 */
import 'server-only'

import {
  DatabaseConfigurationError,
  readDatabaseConfiguration,
} from '@/server/database/config-store'
import type { InstallationPublicStatus } from '@/server/database/types'

export function readInstallationPublicStatus(): InstallationPublicStatus {
  try {
    const configuration = readDatabaseConfiguration()
    if (!configuration) return { status: 'UNCONFIGURED', provider: null }

    const connection = configuration.connection
    const summary =
      connection.provider === 'sqlite'
        ? { database: 'slothvault.db' }
        : {
            host: connection.config.host,
            database: connection.config.database,
          }
    return {
      status: configuration.status,
      provider: configuration.provider,
      ...summary,
    }
  } catch (error) {
    const message =
      error instanceof DatabaseConfigurationError
        ? error.message
        : 'Unable to resolve installation state'
    return {
      status: 'MAINTENANCE',
      provider: null,
      error: message,
    }
  }
}

export function isInstallationApiPath(pathname: string) {
  return pathname === '/api/install' || pathname.startsWith('/api/install/')
}
