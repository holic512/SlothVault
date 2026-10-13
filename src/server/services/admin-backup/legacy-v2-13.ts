/**
 * @file legacy-v2-13.ts
 * @project SlothVault
 * @module Legacy Account Backup Conversion
 * @description Explicitly validates the 2.13.0 source contract before adding portable operator attribution.
 * @logic Reject new fields and detached legacy references, resolve identities from source accounts, and retain frozen bytes and archive digests unchanged.
 * @dependencies zod, current backup schema, temporary record store
 * @index_tags backup,compatibility,conversion,audit,identity
 * @author holic512
 */
import 'server-only'
import { z } from 'zod'
import { USER_ATTRIBUTION_FIELDS, type UserIdentity } from '@/lib/user-attribution'
import { backupDataSchema, type BackupData } from './database-schema'
import { legacyWalletData, convertWalletStore } from './legacy-v2-14'
import { ACTIVE_BACKUP_COLLECTION_KEYS } from './constants'
import type { RecordStore } from './record-store'

export const attributionCollections: Record<string, keyof typeof USER_ATTRIBUTION_FIELDS> = {
  pointTransactions: 'pointTransaction', giftCardBatches: 'giftCardBatch', membershipGrants: 'membershipGrant', noteInfos: 'noteInfo',
  contracts: 'contract', contractAdminAudits: 'contractAdminAudit', contractCredentials: 'contractCredential', contractCredentialAttempts: 'contractCredentialAttempt',
  releaseCredentials: 'releaseCredential', releaseCredentialAttempts: 'releaseCredentialAttempt', commissionPayments: 'commissionPayment',
  commissionChanges: 'commissionChange', commissionIssues: 'commissionIssue', commissionFiles: 'commissionFile', commissionEvents: 'commissionEvent',
  commissionSubmissions: 'commissionSubmission', commissionProofAttempts: 'commissionProofAttempt',
}
const formerlyRequired: Record<string, string[]> = {
  giftCardBatches: ['createdById'], contracts: ['issuerUserId'], contractAdminAudits: ['actorUserId'], contractCredentials: ['issuerUserId'], contractCredentialAttempts: ['issuerUserId'],
  releaseCredentials: ['issuerUserId'], releaseCredentialAttempts: ['issuerUserId'], commissionPayments: ['createdById'], commissionChanges: ['createdById'], commissionIssues: ['createdById'],
  commissionFiles: ['uploaderUserId'], commissionEvents: ['actorUserId'], commissionProofAttempts: ['issuerUserId'],
}
export const legacyCollectionKeys = ACTIVE_BACKUP_COLLECTION_KEYS.filter(key => key !== 'userDeletionRecords' && key !== 'userWallets')
export const legacyRowSchemas = new Map<string, z.ZodType>()
const sourceCollections: Record<string, z.ZodType> = {}
for (const key of legacyCollectionKeys) {
  const container = backupDataSchema.shape[key]
  let array: z.ZodType = container
  while (!(array instanceof z.ZodArray) && 'unwrap' in array) array = (array as z.ZodDefault<z.ZodType>).unwrap()
  if (!(array instanceof z.ZodArray) || !(array.element instanceof z.ZodObject)) throw new Error('Invalid registered backup collection')
  let row = array.element
  if (key === 'users') row = row.omit({ usernameChangeMonth: true, usernameChangeCount: true, credentialsRevision: true })
  if (attributionCollections[key]) row = row.omit({ attributionJson: true })
  for (const field of formerlyRequired[key] ?? []) {
    const nullable = row.shape[field]
    if (!(nullable instanceof z.ZodNullable)) throw new Error('Invalid legacy operator contract')
    row = row.extend({ [field]: nullable.unwrap() })
  }
  legacyRowSchemas.set(key, row)
  sourceCollections[key] = container.isOptional() ? z.array(row).default([]) : z.array(row)
}
export const legacyPayloadSchema = z.object({ version: z.literal('2.13.0'), mode: z.literal('overwrite'), data: z.object(sourceCollections).strict() }).strict()

type Row = Record<string, unknown> & { id: string }
function convertRow(key: string, row: Row, findUser: (id: string) => Row | undefined): Row {
  const model = attributionCollections[key]
  if (!model) return row
  const snapshots: Record<string, UserIdentity> = {}
  for (const field of USER_ATTRIBUTION_FIELDS[model]) {
    const id = model === 'pointTransaction' && row.type === 'ADMIN_ADJUSTMENT' ? row.referenceId : row[field]
    if (typeof id !== 'string') continue
    const user = findUser(id)
    if (!user) continue // Missing live references are still rejected by relation validation.
    let installationId: string | null = null
    if (typeof row.installationId === 'string') installationId = row.installationId
    if (typeof row.memo === 'string') {
      try { const memo = JSON.parse(row.memo); if (z.string().uuid().safeParse(memo.installationId).success) installationId = memo.installationId } catch { /* Memo validation remains authoritative. */ }
    }
    snapshots[field] = { installationId, userId: id, username: user.username as string, displayName: user.displayName as string | null, role: user.role as UserIdentity['role'] }
  }
  return { ...row, attributionJson: JSON.stringify(snapshots) }
}
export function convertLegacyStore(store: RecordStore) {
  convertWalletStore(store)
  for (const key of legacyCollectionKeys) {
    if (!attributionCollections[key]) continue
    for (const row of store.iterate<Row>(key)) {
      const current = convertRow(key, row, id => store.get<Row>('users', id))
      store.statement('UPDATE records SET json=? WHERE collection=? AND id=?').run(JSON.stringify(current), key, row.id)
    }
  }
}
export function convertLegacyPayload(input: unknown): BackupData {
  const source = legacyPayloadSchema.parse(input)
  const users = new Map((source.data.users as Row[]).map(row => [row.id, row]))
  return backupDataSchema.parse(legacyWalletData(Object.fromEntries(Object.entries(source.data).map(([key, rows]) => [key, (rows as Row[]).map(row => convertRow(key, row, id => users.get(id)))]))))
}
