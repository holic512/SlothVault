/**
 * @file user-attribution.ts
 * @project SlothVault
 * @module Account Audit Identity
 * @description Defines credential-free historical identities and the site-owned attribution registry.
 * @logic Keep mutable account references separate from immutable operator snapshots and validate portable audit data.
 * @dependencies zod
 * @index_tags users,audit,identity,backup
 * @author holic512
 */
import { z } from 'zod'

export const userIdentitySchema = z.object({
  installationId: z.string().uuid().nullable(),
  userId: z.string().regex(/^[1-9]\d*$/),
  username: z.string().min(1).max(255),
  displayName: z.string().max(80).nullable(),
  role: z.enum(['ADMIN', 'USER']),
}).strict()
export type UserIdentity = z.infer<typeof userIdentitySchema>
export const attributionSchema = z.record(z.string(), userIdentitySchema)

export const USER_ATTRIBUTION_FIELDS = {
  pointTransaction: ['operatorUserId'],
  membershipGrant: ['grantedByUserId', 'revokedByUserId'],
  noteInfo: ['authorId'],
  contract: ['issuerUserId'],
  contractAdminAudit: ['actorUserId'],
  contractCredential: ['issuerUserId'],
  contractCredentialAttempt: ['issuerUserId'],
  releaseCredential: ['issuerUserId'],
  releaseCredentialAttempt: ['issuerUserId'],
  commissionPayment: ['createdById', 'confirmedById'],
  commissionChange: ['createdById'],
  commissionIssue: ['createdById'],
  commissionFile: ['uploaderUserId'],
  commissionEvent: ['actorUserId'],
  commissionSubmission: ['actorUserId'],
  commissionProofAttempt: ['issuerUserId'],
} as const
export type AttributionModel = keyof typeof USER_ATTRIBUTION_FIELDS

export function readAttribution(value: string | null | undefined): Record<string, UserIdentity> {
  return value ? attributionSchema.parse(JSON.parse(value)) : {}
}

export const attributionJsonSchema = z.string().max(2048).refine(value => {
  try { return attributionSchema.safeParse(JSON.parse(value)).success } catch { return false }
}, 'Invalid operator attribution').optional().default('{}')

export function attributedOperator(row: { attributionJson?: string | null }, field: string, live?: { username: string; displayName?: string | null } | null) {
  const snapshot = readAttribution(row.attributionJson)[field]
  return snapshot ? { username: snapshot.username, displayName: snapshot.displayName } : { username: live?.username ?? 'System', displayName: live?.displayName ?? null }
}
