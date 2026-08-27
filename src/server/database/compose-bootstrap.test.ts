import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetMasterKeyCacheForTests } from '@/server/config/master-key'
import {
  DatabaseConfigurationError,
  readDatabaseConfiguration,
  resetDatabaseConfigurationCacheForTests,
} from '@/server/database/config-store'
import {
  bootstrapComposeDatabase,
  readComposeBootstrapConnection,
} from '@/server/database/compose-bootstrap'
import type {
  DatabaseConnectionInput,
  StoredDatabaseConfiguration,
} from '@/server/database/types'

type Environment = Record<string, string | undefined>

const originalAppDataPath = process.env.APP_DATA_PATH
const originalEncryptionKey = process.env.ENCRYPTION_KEY
const temporaryDirectories: string[] = []

function useTemporaryDataPath() {
  const path = mkdtempSync(join(tmpdir(), 'slothvault-compose-bootstrap-'))
  temporaryDirectories.push(path)
  process.env.APP_DATA_PATH = path
  delete process.env.ENCRYPTION_KEY
  resetMasterKeyCacheForTests()
  resetDatabaseConfigurationCacheForTests()
  return path
}

afterEach(() => {
  if (originalAppDataPath === undefined) delete process.env.APP_DATA_PATH
  else process.env.APP_DATA_PATH = originalAppDataPath
  if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY
  else process.env.ENCRYPTION_KEY = originalEncryptionKey
  resetMasterKeyCacheForTests()
  resetDatabaseConfigurationCacheForTests()
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

function mysqlEnvironment(): Environment {
  return {
    SLOTHVAULT_AUTO_BOOTSTRAP: '1',
    SLOTHVAULT_BOOTSTRAP_PROVIDER: 'mysql',
    SLOTHVAULT_BOOTSTRAP_HOST: 'mysql',
    SLOTHVAULT_BOOTSTRAP_PORT: '3306',
    SLOTHVAULT_BOOTSTRAP_DATABASE: 'slothvault',
    SLOTHVAULT_BOOTSTRAP_USERNAME: 'slothvault',
    SLOTHVAULT_BOOTSTRAP_PASSWORD: 'test-password',
    SLOTHVAULT_BOOTSTRAP_TLS_ENABLED: 'false',
  }
}

function postgresqlEnvironment(): Environment {
  return {
    ...mysqlEnvironment(),
    SLOTHVAULT_BOOTSTRAP_PROVIDER: 'postgresql',
    SLOTHVAULT_BOOTSTRAP_HOST: 'postgresql',
    SLOTHVAULT_BOOTSTRAP_PORT: '5432',
  }
}

function sqliteEnvironment(): Environment {
  return {
    SLOTHVAULT_AUTO_BOOTSTRAP: '1',
    SLOTHVAULT_BOOTSTRAP_PROVIDER: 'sqlite',
  }
}

function storedConfiguration(
  connection: DatabaseConnectionInput,
  status: 'CONFIGURING' | 'SCHEMA_READY' | 'INSTALLED',
): StoredDatabaseConfiguration {
  return {
    version: 1,
    status,
    provider: connection.provider,
    connection,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
  }
}

describe('Compose database bootstrap', () => {
  it('leaves the interactive installer unchanged when bootstrap is not enabled', async () => {
    const initializeDatabase = vi.fn()

    await expect(
      bootstrapComposeDatabase({}, {
        readConfiguration: () => null,
        initializeDatabase,
      }),
    ).resolves.toEqual({ enabled: false })

    expect(initializeDatabase).not.toHaveBeenCalled()
  })

  it('parses all three provider contracts', () => {
    expect(readComposeBootstrapConnection(sqliteEnvironment())).toEqual({
      provider: 'sqlite',
      config: {},
    })
    expect(readComposeBootstrapConnection(mysqlEnvironment())).toMatchObject({
      provider: 'mysql',
      config: {
        host: 'mysql',
        port: 3306,
        database: 'slothvault',
        username: 'slothvault',
        tlsEnabled: false,
      },
    })
    expect(readComposeBootstrapConnection(postgresqlEnvironment())).toMatchObject({
      provider: 'postgresql',
      config: {
        host: 'postgresql',
        port: 5432,
        database: 'slothvault',
        username: 'slothvault',
        tlsEnabled: false,
      },
    })
  })

  it('rejects invalid provider-specific environment values', () => {
    const sqliteWithServerValues = {
      ...sqliteEnvironment(),
      SLOTHVAULT_BOOTSTRAP_HOST: 'mysql',
    }
    expect(() => readComposeBootstrapConnection(sqliteWithServerValues)).toThrow(
      'SQLite Compose bootstrap does not accept server connection values',
    )

    const missingPassword = mysqlEnvironment()
    delete missingPassword.SLOTHVAULT_BOOTSTRAP_PASSWORD
    expect(() => readComposeBootstrapConnection(missingPassword)).toThrow(
      'Compose bootstrap requires SLOTHVAULT_BOOTSTRAP_PASSWORD',
    )
  })

  it('initializes a fresh matching target and clears bootstrap secrets', async () => {
    const environment = mysqlEnvironment()
    const connection = readComposeBootstrapConnection(environment)
    if (!connection) throw new Error('Expected Compose bootstrap connection')
    const initializeDatabase = vi.fn().mockResolvedValue({ status: 'SCHEMA_READY' })

    await expect(
      bootstrapComposeDatabase(environment, {
        readConfiguration: () => null,
        initializeDatabase,
      }),
    ).resolves.toEqual({ enabled: true, provider: 'mysql', initialized: true })

    expect(initializeDatabase).toHaveBeenCalledWith(connection)
    expect(environment.SLOTHVAULT_BOOTSTRAP_PASSWORD).toBeUndefined()
    expect(environment.SLOTHVAULT_AUTO_BOOTSTRAP).toBeUndefined()
  })

  it('initializes a fresh SQLite data directory to SCHEMA_READY', async () => {
    const dataPath = useTemporaryDataPath()

    await expect(bootstrapComposeDatabase(sqliteEnvironment())).resolves.toEqual({
      enabled: true,
      provider: 'sqlite',
      initialized: true,
    })

    expect(readDatabaseConfiguration()).toMatchObject({
      provider: 'sqlite',
      status: 'SCHEMA_READY',
    })
    expect(existsSync(join(dataPath, 'database', 'slothvault.db'))).toBe(true)
  })

  it('resumes only a matching pending configuration', async () => {
    const environment = postgresqlEnvironment()
    const connection = readComposeBootstrapConnection(environment)
    if (!connection) throw new Error('Expected Compose bootstrap connection')
    const initializeDatabase = vi.fn().mockResolvedValue({ status: 'SCHEMA_READY' })

    await bootstrapComposeDatabase(environment, {
      readConfiguration: () => storedConfiguration(connection, 'CONFIGURING'),
      initializeDatabase,
    })

    expect(initializeDatabase).toHaveBeenCalledOnce()
    expect(initializeDatabase).toHaveBeenCalledWith(connection)
  })

  it('keeps a matching initialized configuration untouched', async () => {
    const environment = mysqlEnvironment()
    const connection = readComposeBootstrapConnection(environment)
    if (!connection) throw new Error('Expected Compose bootstrap connection')
    const initializeDatabase = vi.fn()

    await expect(
      bootstrapComposeDatabase(environment, {
        readConfiguration: () => storedConfiguration(connection, 'INSTALLED'),
        initializeDatabase,
      }),
    ).resolves.toEqual({ enabled: true, provider: 'mysql', initialized: false })

    expect(initializeDatabase).not.toHaveBeenCalled()
  })

  it('refuses a persisted connection mismatch without initializing', async () => {
    const environment = mysqlEnvironment()
    const connection = readComposeBootstrapConnection(environment)
    if (!connection || connection.provider !== 'mysql') {
      throw new Error('Expected MySQL Compose bootstrap connection')
    }
    const initializeDatabase = vi.fn()
    const persisted = {
      ...connection,
      config: { ...connection.config, database: 'another_database' },
    }

    await expect(
      bootstrapComposeDatabase(environment, {
        readConfiguration: () => storedConfiguration(persisted, 'SCHEMA_READY'),
        initializeDatabase,
      }),
    ).rejects.toEqual(expect.objectContaining({
      name: DatabaseConfigurationError.name,
      message: 'Compose bootstrap configuration does not match persisted database configuration',
    }))

    expect(initializeDatabase).not.toHaveBeenCalled()
    expect(environment.SLOTHVAULT_BOOTSTRAP_PASSWORD).toBeUndefined()
  })

  it('preserves the target when initialization rejects a non-empty database', async () => {
    const environment = mysqlEnvironment()
    const initializeDatabase = vi.fn().mockRejectedValue(
      new DatabaseConfigurationError('The selected MySQL database is not empty'),
    )

    await expect(
      bootstrapComposeDatabase(environment, {
        readConfiguration: () => null,
        initializeDatabase,
      }),
    ).rejects.toThrow('The selected MySQL database is not empty')

    expect(initializeDatabase).toHaveBeenCalledOnce()
    expect(environment.SLOTHVAULT_BOOTSTRAP_PASSWORD).toBeUndefined()
  })
})
