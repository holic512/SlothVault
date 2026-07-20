import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resetMasterKeyCacheForTests } from '@/server/config/master-key'
import {
  createPendingDatabaseConfiguration,
  databaseConfigurationPath,
  databaseConfigurationSentinelPath,
  readDatabaseConfiguration,
  removePendingDatabaseConfiguration,
  resetDatabaseConfigurationCacheForTests,
  updateDatabaseConfigurationStatus,
  writeDatabaseConfiguration,
} from '@/server/database/config-store'

const originalAppDataPath = process.env.APP_DATA_PATH
const originalEncryptionKey = process.env.ENCRYPTION_KEY
const temporaryDirectories: string[] = []

function useTemporaryDataPath() {
  const path = mkdtempSync(join(tmpdir(), 'slothvault-config-'))
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

describe('encrypted database configuration', () => {
  it('persists an authenticated payload without plaintext credentials', () => {
    useTemporaryDataPath()
    const pending = createPendingDatabaseConfiguration({
      provider: 'postgresql',
      config: {
        host: 'database.internal',
        port: 5432,
        database: 'slothvault',
        username: 'installer',
        password: 'never-write-this-in-plaintext',
        tlsEnabled: true,
        caPem: '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----',
      },
    })

    writeDatabaseConfiguration(pending)

    const raw = readFileSync(databaseConfigurationPath(), 'utf8')
    expect(raw).not.toContain('never-write-this-in-plaintext')
    expect(raw).not.toContain('database.internal')
    expect(readDatabaseConfiguration()).toEqual(pending)
    expect(statSync(databaseConfigurationPath()).mode & 0o777).toBe(0o600)
    expect(statSync(databaseConfigurationSentinelPath()).mode & 0o777).toBe(0o600)
  })

  it('allows reset only while configuration is pending', () => {
    useTemporaryDataPath()
    writeDatabaseConfiguration(
      createPendingDatabaseConfiguration({ provider: 'sqlite', config: {} }),
    )
    removePendingDatabaseConfiguration()
    expect(readDatabaseConfiguration()).toBeNull()
    expect(() => statSync(databaseConfigurationSentinelPath())).toThrow()

    writeDatabaseConfiguration(
      createPendingDatabaseConfiguration({ provider: 'sqlite', config: {} }),
    )
    updateDatabaseConfigurationStatus('SCHEMA_READY')
    expect(() => removePendingDatabaseConfiguration()).toThrow(
      'Initialized database configuration cannot be reset',
    )
  })

  it('rejects configuration encrypted with a different master key', () => {
    useTemporaryDataPath()
    process.env.ENCRYPTION_KEY = 'first-stable-secret'
    resetMasterKeyCacheForTests()
    writeDatabaseConfiguration(
      createPendingDatabaseConfiguration({ provider: 'sqlite', config: {} }),
    )

    process.env.ENCRYPTION_KEY = 'different-stable-secret'
    resetMasterKeyCacheForTests()
    resetDatabaseConfigurationCacheForTests()
    expect(() => readDatabaseConfiguration()).toThrow(
      'Database configuration is invalid or cannot be decrypted',
    )
  })

  it('enters maintenance when a configured database file is lost', () => {
    useTemporaryDataPath()
    writeDatabaseConfiguration(
      createPendingDatabaseConfiguration({ provider: 'sqlite', config: {} }),
    )
    updateDatabaseConfigurationStatus('INSTALLED')

    rmSync(databaseConfigurationPath(), { force: true })
    resetDatabaseConfigurationCacheForTests()

    expect(() => readDatabaseConfiguration()).toThrow('Database configuration is missing')
  })
})
