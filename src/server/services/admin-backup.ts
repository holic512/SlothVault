/**
 * @file admin-backup.ts
 * @project SlothVault
 * @module Admin Backup and Recovery
 * @description Preserves the public entry point for system reset.
 * @logic Re-export the reset service used by the administration route.
 * @dependencies system reset
 * @index_tags admin,backup,restore,service,facade
 * @author holic512
 */
import 'server-only'

export { resetSystem } from './admin-backup/reset'
