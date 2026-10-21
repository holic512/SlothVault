/**
 * @file legacy-v2-18.ts
 * @project SlothVault
 * @module Project Menu Backup Compatibility
 * @description Validates pre-icon menu records and adds automatic icons to converted backup data.
 * @logic Reject icon fields in old source rows and add null only in parsed payloads or the temporary record store.
 * @dependencies backup row schemas, portable database export, RecordStore
 * @index_tags backup,compatibility,project-menu,icons
 * @author holic512
 */
import 'server-only'
import { z } from 'zod'
import { legacyProjectMenuSchema } from './database-schema'
import { parseBackupRow } from './database-export'
import type { RecordStore } from './record-store'

export function parseMenuLegacyRow(key: string, value: unknown): { id: string } {
  return key === 'projectMenus' ? legacyProjectMenuSchema.parse(value) : parseBackupRow(key, value)
}

export function addLegacyMenuIcons(data: Record<string, unknown>) {
  return { ...data, projectMenus: z.array(legacyProjectMenuSchema).parse(data.projectMenus).map(row => ({ ...row, icon: null })) }
}

export function convertMenuIconStore(store: RecordStore) {
  store.statement("UPDATE records SET json=json_set(json,'$.icon',NULL) WHERE collection='projectMenus'").run()
}
