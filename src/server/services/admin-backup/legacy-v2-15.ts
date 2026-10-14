/**
 * @file legacy-v2-15.ts
 * @project SlothVault
 * @module Documentation Backup Compatibility
 * @description Validates pre-documentation backup rows before converting them to the current format.
 * @logic Reject documentation metadata in old source rows and add null only after original-row validation.
 * @dependencies backup row schemas, RecordStore
 * @index_tags backup,compatibility,documentation
 * @author holic512
 */
import 'server-only'
import { z } from 'zod'
import { backupDataSchema } from './database-schema'
import { parseBackupRow } from './database-export'
import type { RecordStore } from './record-store'
const oldVersionSchema = backupDataSchema.shape.projectVersions.element.omit({ documentationStateJson: true })
export function parseDocumentationLegacyRow(key: string, value: unknown): { id: string } {
  return key === 'projectVersions' ? oldVersionSchema.parse(value) : parseBackupRow(key, value)
}
export function convertDocumentationStore(store: RecordStore) {
  for (const row of store.iterate<Record<string, unknown> & { id: string }>('projectVersions')) {
    store.statement('UPDATE records SET json=? WHERE collection=? AND id=?').run(JSON.stringify({ ...row, documentationStateJson: null }), 'projectVersions', row.id)
  }
}

const oldDataSchema = backupDataSchema.extend({ projectVersions: z.array(oldVersionSchema) })
const oldPayloadSchema = z.strictObject({ version: z.literal('2.15.0'), mode: z.literal('overwrite'), data: oldDataSchema })
export function convertDocumentationPayload(input: unknown) {
  return backupDataSchema.parse(oldPayloadSchema.parse(input).data)
}
