/**
 * @file legacy-v2-14.ts
 * @project SlothVault
 * @module Legacy Wallet Backup Conversion
 * @description Validates pre-multi-wallet backups and explicitly converts their single-address identities.
 * @logic Reject new fields in legacy source rows and derive one binding per old wallet address without changing archive bytes.
 * @dependencies zod, current backup schema, record store
 * @index_tags backup,compatibility,wallet,migration
 * @author holic512
 */
import 'server-only'
import { prePublicIdDataSchema, addPublicIdentifiers } from './legacy-v2-20'
import { z } from 'zod'
import { backupDataSchema, legacyProjectMenuSchema } from './database-schema'
import { addLegacyMenuIcons } from './legacy-v2-18'
import { LEGACY_BACKUP_COLLECTION_KEYS } from './constants'
import type { RecordStore } from './record-store'
export const walletLegacyCollectionKeys = LEGACY_BACKUP_COLLECTION_KEYS.filter(key => key !== 'userWallets')
export const walletLegacyRowSchemas = new Map<string, z.ZodType>()
const source: Record<string, z.ZodType> = {}
for (const key of walletLegacyCollectionKeys) {
  let schema: z.ZodType = prePublicIdDataSchema.shape[key]
  while (!(schema instanceof z.ZodArray) && 'unwrap' in schema) schema = (schema as z.ZodDefault<z.ZodType>).unwrap()
  if (!(schema instanceof z.ZodArray) || !(schema.element instanceof z.ZodObject)) throw new Error('Invalid legacy backup collection')
  const row = key === 'projectMenus' ? legacyProjectMenuSchema : key === 'projectVersions' ? schema.element.omit({ documentationStateJson: true }) : key === 'users' ? schema.element.omit({ usernameChangeMonth: true, usernameChangeCount: true, credentialsRevision: true }) : schema.element
  walletLegacyRowSchemas.set(key, row)
  source[key] = prePublicIdDataSchema.shape[key].isOptional() ? z.array(row).default([]) : z.array(row)
}
const legacySchema = z.object({ version: z.literal('2.14.0'), mode: z.literal('overwrite'), data: z.object(source).strict() }).strict()
type OldUser = { id: string; walletAddress: string | null; updatedAt: string }
export function legacyWalletData(data: Record<string, unknown>) {
  return { ...addLegacyMenuIcons(data), userWallets: (data.users as OldUser[]).filter(user => user.walletAddress !== null).map(user => ({ id: user.id, userId: user.id, address: user.walletAddress!, createdAt: user.updatedAt })) }
}
export function convertWalletPayload(input: unknown) { return backupDataSchema.parse(addPublicIdentifiers(legacyWalletData(legacySchema.parse(input).data))) }
export function convertWalletStore(store: RecordStore) {
  for (const user of store.iterate<OldUser & Record<string, unknown>>('users')) {
    if (user.walletAddress) store.put('userWallets', { id: user.id, userId: user.id, address: user.walletAddress, createdAt: user.updatedAt })
    store.statement('UPDATE records SET json=? WHERE collection=? AND id=?').run(JSON.stringify({ ...user, usernameChangeMonth: null, usernameChangeCount: 0, credentialsRevision: 0 }), 'users', user.id)
  }
}
