/**
 * @file legacy-v2-20.ts
 * @project SlothVault
 * @module Public Identifier Backup Compatibility
 * @description Preserves the strict pre-2.21 content contracts before introducing permanent public identities.
 * @logic Validate historical rows without new identity fields, then assign one UUID and retain each source route ID without changing document bytes.
 * @dependencies node:crypto, Zod, backup data schema, RecordStore
 * @index_tags backup,compatibility,public-id,legacy-links
 * @author holic512
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { backupDataSchema } from './database-schema'
import { HttpError } from '@/server/http/errors'
import type { RecordStore } from './record-store'

export const publicIdentityCollections = ['articles', 'projects', 'projectVersions', 'noteInfos'] as const
const identityFields = { publicId: true, legacyUrlId: true } as const
export const prePublicIdDataSchema = backupDataSchema.extend({
  articles: z.array(backupDataSchema.shape.articles.unwrap().unwrap().element.omit(identityFields)).default([]),
  projects: z.array(backupDataSchema.shape.projects.element.omit(identityFields)),
  projectVersions: z.array(backupDataSchema.shape.projectVersions.element.omit(identityFields)),
  noteInfos: z.array(backupDataSchema.shape.noteInfos.element.omit(identityFields)),
})

export function parsePublicIdLegacyRow(key: string, value: unknown): { id: string } {
  let schema: z.ZodType = prePublicIdDataSchema.shape[key as keyof typeof prePublicIdDataSchema.shape]
  while (schema && !(schema instanceof z.ZodArray) && 'unwrap' in schema) schema = (schema as z.ZodDefault<z.ZodType>).unwrap()
  if (!(schema instanceof z.ZodArray)) throw new HttpError('Unknown backup collection', 400, 400)
  const row = (schema.element as z.ZodType).parse(value) as { id: string }
  const required = key === 'projects' ? ['readAccessMode', 'downloadAccessMode', 'readMembershipLevelIds', 'downloadMembershipLevelIds'] : key === 'articles' ? ['allowedMembershipLevelIds'] : []
  if (required.some(field => !Object.hasOwn(value as object, field))) throw new HttpError('Incomplete backup access policy', 400, 400)
  return row
}

export function addPublicIdentifiers(data: Record<string, unknown>) {
  if (publicIdentityCollections.some(key => !Array.isArray(data[key]))) throw new HttpError('Missing legacy content collection', 400, 400)
  return {
    ...data,
    ...Object.fromEntries(publicIdentityCollections.map(key => [key,
      (data[key] as Array<{ id: string }>).map(row => ({ ...row, publicId: randomUUID(), legacyUrlId: row.id })),
    ])),
  }
}

export function convertPublicIdentifierStore(store: RecordStore) {
  for (const key of publicIdentityCollections) {
    for (const row of store.iterate<{ id: string; publicId?: string }>(key)) {
      if (row.publicId !== undefined) continue
      if (Number(row.id) > 2_147_483_647) throw new HttpError('Invalid legacy route ID', 400, 400)
      store.statement('UPDATE records SET json=? WHERE collection=? AND id=?').run(JSON.stringify({ ...row, publicId: randomUUID(), legacyUrlId: row.id }), key, row.id)
    }
  }
}
