/**
 * @file connection-url.ts
 * @project SlothVault
 * @module Database Bootstrap
 * @description Builds fixed-provider connection URLs for the Prisma migration subprocess without logging credentials.
 * @logic Resolve SQLite beneath the managed data directory, percent-encode server credentials with URL primitives, and add strict provider-specific TLS parameters only from validated installer input.
 * @dependencies node:path, app-data, database/types
 * @index_tags database,url,migration,tls,sqlite
 * @author holic512
 */
import 'server-only'

import { resolve } from 'node:path'

import { appDatabasePath } from '@/server/config/app-data'
import type { DatabaseConnectionInput } from '@/server/database/types'

export function sqliteDatabaseFilePath() {
  return resolve(appDatabasePath(), 'slothvault.db')
}

export function databaseConnectionUrl(
  connection: DatabaseConnectionInput,
  options: { caPath?: string } = {},
) {
  if (connection.provider === 'sqlite') {
    return `file:${sqliteDatabaseFilePath()}`
  }

  const protocol = connection.provider === 'postgresql' ? 'postgresql:' : 'mysql:'
  const url = new URL(`${protocol}//localhost`)
  url.hostname = connection.config.host
  url.port = String(connection.config.port)
  url.username = connection.config.username
  url.password = connection.config.password
  url.pathname = `/${connection.config.database}`

  if (connection.config.tlsEnabled) {
    if (connection.provider === 'postgresql') {
      url.searchParams.set('sslmode', 'verify-full')
      if (options.caPath) url.searchParams.set('sslcert', options.caPath)
    } else {
      url.searchParams.set('sslaccept', 'strict')
      if (options.caPath) url.searchParams.set('sslcert', options.caPath)
    }
  }
  return url.toString()
}
