/**
 * @file compatibility.ts
 * @project SlothVault
 * @module Backup Data Compatibility
 * @description Resolves portable backup data versions independently of application releases and database schema revisions.
 * @logic Validate registered source contracts, convert legacy attribution, wallets, documentation and menu icons in a temporary store, and retire cards only from pre-2.18 snapshots.
 * @dependencies backup data contracts, portable database export, private record store
 * @index_tags backup,version,compatibility,conversion,restore
 * @author holic512
 */
import 'server-only'
import { discardRetiredCardStore } from './retired-gift-cards'
import { parseDocumentationLegacyRow, convertDocumentationStore } from './legacy-v2-15'
import { walletLegacyCollectionKeys, walletLegacyRowSchemas, convertWalletStore } from './legacy-v2-14'
import { convertLegacyStore, legacyCollectionKeys, legacyRowSchemas } from './legacy-v2-13'
import { convertMenuIconStore, parseMenuLegacyRow } from './legacy-v2-18'
import type { BackupCompatibility } from '@/types/backup'
import { HttpError } from '@/server/http/errors'
import { ACTIVE_BACKUP_COLLECTION_KEYS, LEGACY_BACKUP_COLLECTION_KEYS, BACKUP_COLLECTION_KEYS, DATABASE_BACKUP_VERSION, RETIRED_CARD_SOURCE_VERSIONS } from './constants'
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
  ['2.15.0', { collectionKeys: LEGACY_BACKUP_COLLECTION_KEYS, parseRow: parseDocumentationLegacyRow, toCurrentPayload: store => { convertDocumentationStore(store); return storedPayload(store) } }],
  ['2.16.0', { collectionKeys: LEGACY_BACKUP_COLLECTION_KEYS, parseRow: parseMenuLegacyRow, toCurrentPayload: storedPayload }],
  ['2.17.0', { collectionKeys: BACKUP_COLLECTION_KEYS, parseRow: parseMenuLegacyRow, toCurrentPayload: storedPayload }],
  ['2.18.0', { collectionKeys: ACTIVE_BACKUP_COLLECTION_KEYS, parseRow: parseMenuLegacyRow, toCurrentPayload: storedPayload }],
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
  const adapter = adapters.get(compatibility.sourceVersion)!
  if (compatibility.sourceVersion === DATABASE_BACKUP_VERSION) return adapter
  return { ...adapter, toCurrentPayload: store => {
    convertMenuIconStore(store)
    const payload = adapter.toCurrentPayload(store)
    if (RETIRED_CARD_SOURCE_VERSIONS.has(compatibility.sourceVersion)) discardRetiredCardStore(store)
    return payload
  } }
}
