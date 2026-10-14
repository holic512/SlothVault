/**
 * @file compatibility.ts
 * @project SlothVault
 * @module Backup Data Compatibility
 * @description Resolves portable backup data versions independently of application releases and database schema revisions.
 * @logic Admit only explicitly registered source formats, validate source rows before conversion, and convert 2.13 attribution and 2.14 single-wallet identities, and 2.15 documentation-free snapshots, and build current payloads in a temporary record store.
 * @dependencies backup data contracts, portable database export, private record store
 * @index_tags backup,version,compatibility,conversion,restore
 * @author holic512
 */
import 'server-only'
import { parseDocumentationLegacyRow, convertDocumentationStore } from './legacy-v2-15'
import { walletLegacyCollectionKeys, walletLegacyRowSchemas, convertWalletStore } from './legacy-v2-14'
import { convertLegacyStore, legacyCollectionKeys, legacyRowSchemas } from './legacy-v2-13'
import type { BackupCompatibility } from '@/types/backup'
import { HttpError } from '@/server/http/errors'
import { ACTIVE_BACKUP_COLLECTION_KEYS, DATABASE_BACKUP_VERSION } from './constants'
import { parseBackupRow, storedPayload } from './database-export'
import type { DatabaseImportPayload } from './database-schema'
import type { RecordStore } from './record-store'

type BackupVersionAdapter = {
  collectionKeys: readonly string[]
  // Future adapters must validate the original row before converting it. Archive digests always cover original bytes.
  parseRow: (key: string, value: unknown) => { id: string }
  toCurrentPayload: (store: RecordStore) => DatabaseImportPayload
}

// Add a source-version adapter only together with its source schema, explicit conversions, and compatibility tests.
const adapters: ReadonlyMap<string, BackupVersionAdapter> = new Map<string, BackupVersionAdapter>([
  ['2.13.0', { collectionKeys: legacyCollectionKeys, parseRow: (key, value) => legacyRowSchemas.get(key)!.parse(value) as { id: string }, toCurrentPayload: store => { convertLegacyStore(store); return storedPayload(store) } }],
  ['2.14.0', { collectionKeys: walletLegacyCollectionKeys, parseRow: (key, value) => walletLegacyRowSchemas.get(key)!.parse(value) as { id: string }, toCurrentPayload: store => { convertWalletStore(store); return storedPayload(store) } }],
  ['2.15.0', { collectionKeys: ACTIVE_BACKUP_COLLECTION_KEYS, parseRow: parseDocumentationLegacyRow, toCurrentPayload: store => { convertDocumentationStore(store); return storedPayload(store) } }],
  [DATABASE_BACKUP_VERSION, { collectionKeys: ACTIVE_BACKUP_COLLECTION_KEYS, parseRow: parseBackupRow, toCurrentPayload: storedPayload }],
])

export function backupCompatibility(manifest: { formatVersion?: unknown; databaseVersion?: unknown }): BackupCompatibility {
  const sourceVersion = typeof manifest.databaseVersion === 'string' ? manifest.databaseVersion : ''
  const common = { sourceVersion, targetVersion: DATABASE_BACKUP_VERSION }
  if (manifest.formatVersion !== 2) return { ...common, status: 'unsupported', reason: 'format' }
  if (!adapters.has(sourceVersion)) return { ...common, status: 'unsupported', reason: 'data-version' }
  return { ...common, status: sourceVersion === DATABASE_BACKUP_VERSION ? 'current' : 'convertible', reason: null }
}

export function requireBackupCompatibility(manifest: { formatVersion?: unknown; databaseVersion?: unknown }): BackupVersionAdapter {
  const compatibility = backupCompatibility(manifest)
  if (compatibility.status === 'unsupported') throw new HttpError('Unsupported backup format or data version', 400, 400, { reason: 'BACKUP_UNSUPPORTED_FORMAT', compatibility })
  return adapters.get(compatibility.sourceVersion)!
}
