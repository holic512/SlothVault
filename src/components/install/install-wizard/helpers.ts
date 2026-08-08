/**
 * @file helpers.ts
 * @project SlothVault
 * @module First-run Installation
 * @description Provides validation guards, error normalization, and database configuration assembly for installation.
 * @logic Validate server-provided provider and status values, distinguish form validation failures, and normalize connection form values for API requests.
 * @dependencies Installation workflow types
 * @index_tags install,validation,database,configuration,errors
 * @author holic512
 */
import type {
  ConnectionValues,
  DatabaseConfig,
  DatabaseProvider,
  InstallationStatus,
} from './types'

const validStatuses = new Set<InstallationStatus>([
  'UNCONFIGURED',
  'CONFIGURING',
  'SCHEMA_READY',
  'INSTALLED',
  'MAINTENANCE',
])

export function isDatabaseProvider(value: unknown): value is DatabaseProvider {
  return value === 'sqlite' || value === 'mysql' || value === 'postgresql'
}

export function isInstallationStatus(value: unknown): value is InstallationStatus {
  return typeof value === 'string' && validStatuses.has(value as InstallationStatus)
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function isFormValidationError(error: unknown): error is { errorFields: unknown[] } {
  return typeof error === 'object' && error !== null && 'errorFields' in error
}

export function buildDatabaseConfig(provider: DatabaseProvider, values: ConnectionValues): DatabaseConfig {
  if (provider === 'sqlite') return {}

  const config: DatabaseConfig = {
    host: values.host?.trim() ?? '',
    port: values.port ?? (provider === 'mysql' ? 3306 : 5432),
    database: values.database?.trim() ?? '',
    username: values.username?.trim() ?? '',
    password: values.password ?? '',
    tlsEnabled: Boolean(values.tlsEnabled),
  }

  const caPem = values.caPem?.trim()
  if (caPem) config.caPem = caPem
  return config
}
