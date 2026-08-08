/**
 * @file admin-backup.ts
 * @project SlothVault
 * @module Admin Backup and Recovery
 * @description Preserves the public entry point for database backups, upload archives, imports, and system reset.
 * @logic Re-export focused backup modules so existing API routes and tests retain the same service contract.
 * @dependencies backup constants, schemas, validation, database transfer, file transfer, system reset
 * @index_tags admin,backup,restore,service,facade
 * @author holic512
 */
import 'server-only'

export {
  DATABASE_IMPORT_CONTENT_LENGTH_MAX_BYTES,
  DATABASE_RECORD_LIMIT,
  FILES_IMPORT_CONTENT_LENGTH_MAX_BYTES,
  ZIP_ENTRY_LIMIT,
  ZIP_ENTRY_MAX_BYTES,
  ZIP_FILE_MAX_BYTES,
  ZIP_PATH_MAX_BYTES,
  ZIP_TOTAL_UNCOMPRESSED_MAX_BYTES,
  type ImportMode,
} from './admin-backup/constants'
export {
  type BackupData,
  type DatabaseImportPayload,
} from './admin-backup/database-schema'
export {
  assertRequestContentLength,
  parseDatabaseImportPayload,
} from './admin-backup/database-validation'
export { exportDatabaseBackup } from './admin-backup/database-export'
export { importDatabaseBackup } from './admin-backup/database-import'
export { createFilesExportArchive } from './admin-backup/files-export'
export { importFilesBackup } from './admin-backup/files-import'
export { resetSystem } from './admin-backup/reset'
