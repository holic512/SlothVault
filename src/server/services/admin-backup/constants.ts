/**
 * @file constants.ts
 * @project SlothVault
 * @module Admin Backup Constants
 * @description Defines chunk and path safeguards together with internal database and reset invariants.
 * @logic Centralize business scalar, transaction, chunk, and standard upload-directory invariants used by backup workflows.
 * @dependencies admin file business-type configuration
 * @index_tags admin,backup,limits,constants,transactions,zip
 * @author holic512
 */
import 'server-only'

import { commissionCollectionKeys } from '@/server/commissions/backup'
import { BUSINESS_TYPE_CONFIG } from '@/server/services/admin-files'

export const ZIP_PATH_MAX_BYTES = 1024
export const DATABASE_BACKUP_VERSION = '2.14.0' as const
export const BACKUP_MANIFEST_MAX_BYTES = 16 * 1024 * 1024
export const RESTORE_COMMIT_CONFIG_KEY = '__backup_restore_commit__'

export const DATABASE_BIGINT_MAX = 9_223_372_036_854_775_807n
export const INT_MIN = -2_147_483_648
export const INT_MAX = 2_147_483_647
export const SMALL_INT_MIN = -32_768
export const SMALL_INT_MAX = 32_767
const configuredTransactionTimeout = Number(process.env.BACKUP_DATABASE_TRANSACTION_TIMEOUT_MS ?? 3_600_000)
export const DATABASE_TRANSACTION_TIMEOUT_MS = Number.isSafeInteger(configuredTransactionTimeout) && configuredTransactionTimeout > 0 && configuredTransactionTimeout <= 2_147_483_647 ? configuredTransactionTimeout : 3_600_000
export const BACKUP_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024
export const BACKUP_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000
export const DATABASE_TRANSACTION_MAX_WAIT_MS = 10_000
export const STANDARD_RESET_DIRECTORIES = [
  ...new Set(Object.values(BUSINESS_TYPE_CONFIG).map((config) => config.dir)),
]

export const BACKUP_COLLECTION_KEYS = [
  ...commissionCollectionKeys,
  'users',
  'userDeletionRecords',
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
  'fileReferences',
  'systemConfigs',
  'systemHomepages',
  'contracts',
  'contractAdminAudits',
  'contractCredentials',
  'contractCredentialAttempts',
  'releaseCredentials',
  'releaseCredentialAttempts',
] as const

export const ACTIVE_BACKUP_COLLECTION_KEYS = BACKUP_COLLECTION_KEYS

export const DEPRECATED_CONFIG_KEYS = new Set([
  'solana_network',
  'SOLANA_RPC_URL',
  'SOLANA_DEVNET_RPC_URL',
  'FILEBASE_ACCESS_KEY',
  'FILEBASE_SECRET_KEY',
  'FILEBASE_BUCKET',
  'FILEBASE_ENDPOINT',
])
