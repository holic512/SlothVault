/**
 * @file admin-users.ts
 * @project SlothVault
 * @module Account Management DTOs
 * @description Defines credential-free deletion previews and audit history for the user management screen.
 * @logic Keep operational account data distinct from historical identities and explicit deletion blockers.
 * @dependencies user-attribution identity
 * @index_tags users,admin,deletion,dto,audit
 * @author holic512
 */
import type { UserIdentity } from '@/lib/user-attribution'
export type DeletionBlockerReason = 'CURRENT_ADMIN' | 'LAST_ADMIN' | 'CUSTOMER_CONTRACTS' | 'CUSTOMER_COMMISSIONS' | 'CLAIMED_INVITATIONS'
export type AccountDeletionPreview = {
  userId: string; allowed: boolean; blockers: Array<{ reason: DeletionBlockerReason; count: number }>
  cleanup: Record<string, number>; retained: Record<string, number>
}
export type DeletedUserRow = {
  id: string; user: UserIdentity; actor: UserIdentity; createdAt: string; deletedAt: string
  summary: { cleanup: Record<string, number>; retained: Record<string, number> }
}
