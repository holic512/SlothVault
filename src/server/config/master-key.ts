/**
 * @file master-key.ts
 * @project SlothVault
 * @module Runtime Configuration
 * @description Supplies the stable root secret used by encrypted database configuration and existing Solana secrets.
 * @logic Prefer ENCRYPTION_KEY, otherwise atomically create a private persistent key file and expose the resolved value to legacy consumers.
 * @dependencies node:crypto, node:fs, app-data
 * @index_tags encryption,master-key,bootstrap,secrets
 * @author holic512
 */
import 'server-only'

import { randomBytes } from 'node:crypto'
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { appConfigPath, ensureAppDataDirectories } from '@/server/config/app-data'

const MASTER_KEY_BYTES = 32
const MASTER_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/

let cachedMasterKey: string | undefined

function validateMasterKey(value: string) {
  const key = value.trim()
  if (!MASTER_KEY_PATTERN.test(key)) {
    throw new Error('The persisted application master key is invalid')
  }
  return key
}

export function masterKeyPath() {
  return resolve(appConfigPath(), 'master.key')
}

export function getMasterKey() {
  if (cachedMasterKey) return cachedMasterKey

  const configured = process.env.ENCRYPTION_KEY?.trim()
  if (configured) {
    cachedMasterKey = configured
    return configured
  }

  ensureAppDataDirectories()
  const path = masterKeyPath()
  let key: string
  try {
    key = validateMasterKey(readFileSync(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error

    const generated = randomBytes(MASTER_KEY_BYTES).toString('base64url')
    try {
      const descriptor = openSync(path, 'wx', 0o600)
      try {
        writeFileSync(descriptor, `${generated}\n`, { encoding: 'utf8' })
      } finally {
        closeSync(descriptor)
      }
      key = generated
    } catch (createError) {
      if ((createError as NodeJS.ErrnoException).code !== 'EEXIST') throw createError
      key = validateMasterKey(readFileSync(path, 'utf8'))
    }
  }

  cachedMasterKey = key
  process.env.ENCRYPTION_KEY = key
  return key
}

export function resetMasterKeyCacheForTests() {
  cachedMasterKey = undefined
}
