/**
 * @file retired-core-data.ts
 * @project SlothVault
 * @module Retired Core Backup Guard
 * @description Rejects old core contracts and commissions without importing removed business implementations.
 * @logic Permit only empty historical collections as compatibility padding; never migrate or silently discard their records.
 * @dependencies HttpError
 * @index_tags backup,compatibility,retirement
 * @author holic512
 */
import { HttpError } from '@/server/http/errors'
export const RETIRED_CORE_COLLECTIONS = [
  'contracts', 'contractAdminAudits', 'contractCredentials', 'contractCredentialAttempts',
  'commissionTemplates', 'commissionTemplateVersions', 'commissionSettings', 'commissions',
  'commissionMilestones', 'commissionPlans', 'commissionFiles', 'commissionChanges', 'commissionDeliveries',
  'commissionDeliveryItems', 'commissionIssues', 'commissionAcceptances', 'commissionPayments', 'commissionEvents',
  'commissionInvitations', 'commissionAgreements', 'commissionSubmissions', 'commissionProofAttempts',
] as const
export function rejectRetiredCoreData(): never {
  throw new HttpError('Backups containing retired core contract or commission data are not supported', 400, 400, { reason: 'BACKUP_RETIRED_CORE_DATA' })
}
export function stripEmptyRetiredCollections(data: Record<string, unknown>) {
  const result = { ...data }
  for (const key of RETIRED_CORE_COLLECTIONS) if (Object.hasOwn(result, key)) {
    if (!Array.isArray(result[key]) || result[key].length) rejectRetiredCoreData()
    delete result[key]
  }
  return result
}
