/**
 * @file config-store.ts
 * @project SlothVault
 * @module Database Bootstrap
 * @description Encrypts, validates, atomically persists, and reads the selected database configuration before Prisma is available.
 * @logic Derive a purpose-separated AES-256-GCM key from the stable master key, authenticate the complete JSON payload, and never expose stored credentials through status DTOs.
 * @dependencies node:crypto, node:fs, zod, master-key, database/types
 * @index_tags database,configuration,encryption,aes-gcm,installer
 * @author holic512
 */
import 'server-only'

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto'
import {
  chmodSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'

import { z } from 'zod'

import {
  appConfigPath,
  ensureAppDataDirectories,
} from '@/server/config/app-data'
import { getMasterKey } from '@/server/config/master-key'
import {
  type DatabaseConnectionInput,
  type StoredDatabaseConfiguration,
  storedDatabaseConfigurationSchema,
} from '@/server/database/types'

const envelopeSchema = z.object({
  version: z.literal(1),
  salt: z.string().regex(/^[a-f0-9]{64}$/),
  iv: z.string().regex(/^[a-f0-9]{24}$/),
  tag: z.string().regex(/^[a-f0-9]{32}$/),
  ciphertext: z.string().regex(/^[a-f0-9]+$/),
})

const configurationSentinelSchema = z.object({
  version: z.literal(1),
  status: z.enum(['CONFIGURING', 'SCHEMA_READY', 'INSTALLED']),
  updatedAt: z.string().datetime(),
})

export class DatabaseConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DatabaseConfigurationError'
  }
}

let cachedConfiguration:
  | { mtimeMs: number; value: StoredDatabaseConfiguration }
  | undefined

export function databaseConfigurationPath() {
  return resolve(appConfigPath(), 'database.enc')
}

export function databaseConfigurationSentinelPath() {
  return resolve(appConfigPath(), 'installation.state')
}

function readConfigurationSentinel() {
  try {
    return configurationSentinelSchema.parse(
      JSON.parse(readFileSync(databaseConfigurationSentinelPath(), 'utf8')),
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new DatabaseConfigurationError('Installation state marker is invalid', {
      cause: error,
    })
  }
}

function writeConfigurationSentinel(
  status: StoredDatabaseConfiguration['status'],
) {
  const path = databaseConfigurationSentinelPath()
  const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify({ version: 1, status, updatedAt: new Date().toISOString() })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  chmodSync(temporaryPath, 0o600)
  renameSync(temporaryPath, path)
  chmodSync(path, 0o600)
}

function deriveConfigurationKey(salt: Buffer) {
  return scryptSync(getMasterKey(), salt, 32)
}

export function readDatabaseConfiguration(): StoredDatabaseConfiguration | null {
  let raw: string
  let mtimeMs: number
  try {
    const path = databaseConfigurationPath()
    mtimeMs = statSync(path).mtimeMs
    if (cachedConfiguration?.mtimeMs === mtimeMs) return cachedConfiguration.value
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      cachedConfiguration = undefined
      if (readConfigurationSentinel()) {
        throw new DatabaseConfigurationError('Database configuration is missing')
      }
      return null
    }
    throw new DatabaseConfigurationError('Unable to read database configuration', { cause: error })
  }

  try {
    const envelope = envelopeSchema.parse(JSON.parse(raw))
    const salt = Buffer.from(envelope.salt, 'hex')
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveConfigurationKey(salt),
      Buffer.from(envelope.iv, 'hex'),
    )
    decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'hex')),
      decipher.final(),
    ]).toString('utf8')
    const configuration = storedDatabaseConfigurationSchema.parse(JSON.parse(plaintext))
    cachedConfiguration = { mtimeMs, value: configuration }
    return configuration
  } catch (error) {
    throw new DatabaseConfigurationError('Database configuration is invalid or cannot be decrypted', {
      cause: error,
    })
  }
}

export function writeDatabaseConfiguration(configuration: StoredDatabaseConfiguration) {
  const validated = storedDatabaseConfigurationSchema.parse(configuration)
  const salt = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveConfigurationKey(salt), iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(validated), 'utf8'),
    cipher.final(),
  ])
  const envelope = {
    version: 1 as const,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  }

  ensureAppDataDirectories()
  const path = databaseConfigurationPath()
  const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(envelope)}\n`, { encoding: 'utf8', mode: 0o600 })
  chmodSync(temporaryPath, 0o600)
  renameSync(temporaryPath, path)
  chmodSync(path, 0o600)
  cachedConfiguration = {
    mtimeMs: statSync(path).mtimeMs,
    value: validated,
  }
  writeConfigurationSentinel(validated.status)
}

export function createPendingDatabaseConfiguration(
  connection: DatabaseConnectionInput,
): StoredDatabaseConfiguration {
  const now = new Date().toISOString()
  return {
    version: 1,
    status: 'CONFIGURING',
    provider: connection.provider,
    connection,
    createdAt: now,
    updatedAt: now,
  }
}

export function updateDatabaseConfigurationStatus(
  status: 'SCHEMA_READY' | 'INSTALLED',
) {
  const current = readDatabaseConfiguration()
  if (!current) throw new DatabaseConfigurationError('Database configuration is missing')
  writeDatabaseConfiguration({
    ...current,
    status,
    updatedAt: new Date().toISOString(),
  })
}

export function removePendingDatabaseConfiguration() {
  const current = readDatabaseConfiguration()
  if (!current) return
  if (current.status !== 'CONFIGURING') {
    throw new DatabaseConfigurationError('Initialized database configuration cannot be reset')
  }
  rmSync(databaseConfigurationSentinelPath(), { force: true })
  rmSync(databaseConfigurationPath(), { force: true })
  cachedConfiguration = undefined
}

export function resetDatabaseConfigurationCacheForTests() {
  cachedConfiguration = undefined
}
