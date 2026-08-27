/**
 * @file compose-bootstrap.ts
 * @project SlothVault
 * @module Container Database Bootstrap
 * @description Converts opt-in Docker Compose environment variables into the encrypted, provider-specific database installation state.
 * @logic Validate only the Compose bootstrap contract, refuse to replace a persisted connection, resume a matching pending installation, and clear bootstrap secrets after they are consumed.
 * @dependencies zod, database/config-store, database/installer, database/types
 * @index_tags docker,compose,database,bootstrap,installer,encryption
 * @author holic512
 */
import 'server-only'

import { z } from 'zod'

import {
  DatabaseConfigurationError,
  readDatabaseConfiguration,
} from '@/server/database/config-store'
import { initializeEmptyDatabase } from '@/server/database/installer'
import {
  databaseConnectionInputSchema,
  type DatabaseConnectionInput,
  type StoredDatabaseConfiguration,
} from '@/server/database/types'

type Environment = Record<string, string | undefined>

const AUTO_BOOTSTRAP_VARIABLE = 'SLOTHVAULT_AUTO_BOOTSTRAP'
const BOOTSTRAP_VARIABLES = [
  AUTO_BOOTSTRAP_VARIABLE,
  'SLOTHVAULT_BOOTSTRAP_PROVIDER',
  'SLOTHVAULT_BOOTSTRAP_HOST',
  'SLOTHVAULT_BOOTSTRAP_PORT',
  'SLOTHVAULT_BOOTSTRAP_DATABASE',
  'SLOTHVAULT_BOOTSTRAP_USERNAME',
  'SLOTHVAULT_BOOTSTRAP_PASSWORD',
  'SLOTHVAULT_BOOTSTRAP_TLS_ENABLED',
] as const

const serverBootstrapFields = [
  'SLOTHVAULT_BOOTSTRAP_HOST',
  'SLOTHVAULT_BOOTSTRAP_PORT',
  'SLOTHVAULT_BOOTSTRAP_DATABASE',
  'SLOTHVAULT_BOOTSTRAP_USERNAME',
  'SLOTHVAULT_BOOTSTRAP_PASSWORD',
  'SLOTHVAULT_BOOTSTRAP_TLS_ENABLED',
] as const

type ComposeBootstrapDependencies = {
  readConfiguration: () => StoredDatabaseConfiguration | null
  initializeDatabase: (connection: DatabaseConnectionInput) => Promise<unknown>
}

const defaultDependencies: ComposeBootstrapDependencies = {
  readConfiguration: readDatabaseConfiguration,
  initializeDatabase: initializeEmptyDatabase,
}

function valueFrom(environment: Environment, name: string) {
  return environment[name]?.trim()
}

function requiredValue(environment: Environment, name: string) {
  const value = valueFrom(environment, name)
  if (!value) {
    throw new DatabaseConfigurationError(`Compose bootstrap requires ${name}`)
  }
  return value
}

function parsePort(environment: Environment) {
  const value = requiredValue(environment, 'SLOTHVAULT_BOOTSTRAP_PORT')
  if (!/^\d+$/.test(value)) {
    throw new DatabaseConfigurationError('Compose bootstrap port must be an integer')
  }
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new DatabaseConfigurationError('Compose bootstrap port must be between 1 and 65535')
  }
  return port
}

function parseTlsEnabled(environment: Environment) {
  const value = valueFrom(environment, 'SLOTHVAULT_BOOTSTRAP_TLS_ENABLED')
  if (!value || value === 'false') return false
  if (value === 'true') return true
  throw new DatabaseConfigurationError('Compose bootstrap TLS flag must be true or false')
}

function parseProvider(environment: Environment) {
  const provider = requiredValue(environment, 'SLOTHVAULT_BOOTSTRAP_PROVIDER')
  if (provider === 'sqlite' || provider === 'mysql' || provider === 'postgresql') {
    return provider
  }
  throw new DatabaseConfigurationError('Compose bootstrap provider is invalid')
}

function parseServerConnection(environment: Environment, provider: 'mysql' | 'postgresql') {
  const candidate = {
    provider,
    config: {
      host: requiredValue(environment, 'SLOTHVAULT_BOOTSTRAP_HOST'),
      port: parsePort(environment),
      database: requiredValue(environment, 'SLOTHVAULT_BOOTSTRAP_DATABASE'),
      username: requiredValue(environment, 'SLOTHVAULT_BOOTSTRAP_USERNAME'),
      password: requiredValue(environment, 'SLOTHVAULT_BOOTSTRAP_PASSWORD'),
      tlsEnabled: parseTlsEnabled(environment),
    },
  }

  try {
    return databaseConnectionInputSchema.parse(candidate)
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new DatabaseConfigurationError('Compose bootstrap connection is invalid', {
        cause: error,
      })
    }
    throw error
  }
}

function hasServerBootstrapValues(environment: Environment) {
  return serverBootstrapFields.some((field) => Boolean(valueFrom(environment, field)))
}

export function readComposeBootstrapConnection(environment: Environment = process.env) {
  const autoBootstrap = valueFrom(environment, AUTO_BOOTSTRAP_VARIABLE)
  if (!autoBootstrap) return null
  if (autoBootstrap !== '1') {
    throw new DatabaseConfigurationError(`${AUTO_BOOTSTRAP_VARIABLE} must be 1 when set`)
  }

  const provider = parseProvider(environment)
  if (provider === 'sqlite') {
    if (hasServerBootstrapValues(environment)) {
      throw new DatabaseConfigurationError(
        'SQLite Compose bootstrap does not accept server connection values',
      )
    }
    return { provider: 'sqlite' as const, config: {} }
  }

  return parseServerConnection(environment, provider)
}

export function clearComposeBootstrapEnvironment(environment: Environment = process.env) {
  for (const variable of BOOTSTRAP_VARIABLES) delete environment[variable]
}

export function sameDatabaseConnection(
  left: DatabaseConnectionInput,
  right: DatabaseConnectionInput,
) {
  if (left.provider !== right.provider) return false
  if (left.provider === 'sqlite' || right.provider === 'sqlite') return true

  return (
    left.config.host === right.config.host &&
    left.config.port === right.config.port &&
    left.config.database === right.config.database &&
    left.config.username === right.config.username &&
    left.config.password === right.config.password &&
    left.config.tlsEnabled === right.config.tlsEnabled &&
    left.config.caPem === right.config.caPem
  )
}

export async function bootstrapComposeDatabase(
  environment: Environment = process.env,
  dependencies: Partial<ComposeBootstrapDependencies> = {},
) {
  if (!valueFrom(environment, AUTO_BOOTSTRAP_VARIABLE)) {
    return { enabled: false as const }
  }
  try {
    const connection = readComposeBootstrapConnection(environment)
    if (!connection) return { enabled: false as const }
    clearComposeBootstrapEnvironment(environment)
    const { readConfiguration, initializeDatabase } = {
      ...defaultDependencies,
      ...dependencies,
    }
    const existing = readConfiguration()
    if (existing && !sameDatabaseConnection(existing.connection, connection)) {
      throw new DatabaseConfigurationError(
        'Compose bootstrap configuration does not match persisted database configuration',
      )
    }

    if (!existing || existing.status === 'CONFIGURING') {
      await initializeDatabase(connection)
      return { enabled: true as const, provider: connection.provider, initialized: true as const }
    }

    return { enabled: true as const, provider: connection.provider, initialized: false as const }
  } finally {
    clearComposeBootstrapEnvironment(environment)
  }
}
