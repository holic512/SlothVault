/**
 * @file app-data.ts
 * @project SlothVault
 * @module Runtime Configuration
 * @description Resolves and prepares the persistent application-data directories used before a database exists.
 * @logic Constrain all generated configuration, SQLite, and lock files beneath one deployment-controlled root and create directories with private permissions.
 * @dependencies node:path, node:fs
 * @index_tags app-data,configuration,filesystem,bootstrap
 * @author holic512
 */
import 'server-only'

import { chmodSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

export function appDataPath() {
  const configuredPath = process.env.APP_DATA_PATH?.trim()
  return configuredPath
    ? resolve(/* turbopackIgnore: true */ configuredPath)
    : resolve(/* turbopackIgnore: true */ process.cwd(), 'data')
}

export function appConfigPath() {
  return resolve(appDataPath(), 'config')
}

export function appDatabasePath() {
  return resolve(appDataPath(), 'database')
}

export function ensureAppDataDirectories() {
  for (const path of [appDataPath(), appConfigPath(), appDatabasePath()]) {
    mkdirSync(path, { recursive: true, mode: 0o700 })
    chmodSync(path, 0o700)
  }
}
