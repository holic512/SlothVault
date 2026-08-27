/**
 * @file constants.ts
 * @project SlothVault
 * @module Admin Backup Constants
 * @description Defines public request and ZIP limits together with internal database and reset invariants.
 * @logic Centralize the exact size, record, integer, transaction, reservation, and standard upload-directory limits used by backup workflows.
 * @dependencies admin file business-type configuration
 * @index_tags admin,backup,limits,constants,transactions,zip
 * @author holic512
 */
import 'server-only'

import { BUSINESS_TYPE_CONFIG } from '@/server/services/admin-files'

export const DATABASE_IMPORT_CONTENT_LENGTH_MAX_BYTES = 50 * 1024 * 1024
export const DATABASE_RECORD_LIMIT = 100_000
export const FILES_IMPORT_CONTENT_LENGTH_MAX_BYTES = 260 * 1024 * 1024
export const ZIP_FILE_MAX_BYTES = 250 * 1024 * 1024
export const ZIP_ENTRY_LIMIT = 10_000
export const ZIP_ENTRY_MAX_BYTES = 256 * 1024 * 1024
export const ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES = 1024 * 1024 * 1024
export const ZIP_PATH_MAX_BYTES = 1024

export const DATABASE_BIGINT_MAX = 9_223_372_036_854_775_807n
export const INT_MIN = -2_147_483_648
export const INT_MAX = 2_147_483_647
export const SMALL_INT_MIN = -32_768
export const SMALL_INT_MAX = 32_767
export const DATABASE_TRANSACTION_TIMEOUT_MS = 10 * 60 * 1000
export const DATABASE_TRANSACTION_MAX_WAIT_MS = 10_000
export const STANDARD_RESET_DIRECTORIES = [
  ...new Set(Object.values(BUSINESS_TYPE_CONFIG).map((config) => config.dir)),
]

export const BACKUP_COLLECTION_KEYS = [
  'users',
  'pointTransactions',
  'giftCardBatches',
  'giftCards',
  'membershipLevels',
  'membershipGrants',
  'articles',
  'projects',
  'projectVersions',
  'categories',
  'projectMenus',
  'projectHomes',
  'noteInfos',
  'noteContents',
  'fileManagements',
  'systemConfigs',
  'systemHomepages',
  'contracts',
  'contractAdminAudits',
  'contractCredentials',
  'contractCredentialAttempts',
  'releaseCredentials',
  'releaseCredentialAttempts',
  'merkleTrees',
  'compressedNfts',
] as const

export const DEPRECATED_CONFIG_KEYS = new Set([
  'solana_network',
  'SOLANA_RPC_URL',
  'SOLANA_DEVNET_RPC_URL',
  'FILEBASE_ACCESS_KEY',
  'FILEBASE_SECRET_KEY',
  'FILEBASE_BUCKET',
  'FILEBASE_ENDPOINT',
])

export type ImportMode = 'insert' | 'overwrite'
