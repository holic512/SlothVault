/**
 * @file workflow.ts
 * @project SlothVault
 * @module Commissions workflow
 * @description Central stage gates and actor-specific available actions; no storage or host imports.
 * @logic Never infer progress from payment; frozen records block conflicting mutations until finalized or withdrawn.
 * @dependencies Commissions DTOs
 * @index_tags commissions,authorization,lifecycle
 * @author holic512
 */
import type { CommandAction, Commission, FrozenAction } from './domain'
export function fail(message: string, status = 409): never { throw Object.assign(new Error(message), { status, statusCode: status }) }
export function activeEvidence(evidence: FrozenAction[]): FrozenAction | null { return evidence.find(item => !['FINALIZED', 'WITHDRAWN'].includes(item.status)) ?? null }
export function allowedActions(commission: Commission, admin: boolean, actorId: number, pending: FrozenAction | null): CommandAction[] {
  const actions: CommandAction[] = []
  if (['CLOSED', 'TERMINATED'].includes(commission.stage)) return actions
  if (pending) return admin && pending.status !== 'SUBMITTED' ? ['withdraw'] : []
  if (commission.paused) return admin ? ['resume', 'terminate', 'comment'] : ['comment']
  if (admin) actions.push('pause', 'terminate', 'payment', 'comment')
  else actions.push('comment')
  if (commission.stage === 'DRAFT') {
    actions.push('update-draft', 'submit-request')
    if (admin) actions.push('save-contract')
  }
  if (admin && commission.customerId === null && ['DRAFT', 'REQUESTED', 'CONTRACT_PREPARATION'].includes(commission.stage)) actions.push('invite', 'revoke-invitation')
  if (admin && commission.stage === 'REQUESTED') actions.push('accept', 'return-request')
  if (admin && commission.stage === 'CONTRACT_PREPARATION') actions.push('save-contract', 'publish-contract', 'return-request')
  const unconfirmed = commission.contracts.find(item => !item.effectiveAt && !item.rejectedAt && !item.confirmation)
  if (unconfirmed) {
    if (admin) actions.push('record-confirmation')
    if (actorId === commission.customerId) actions.push('confirm-contract', 'decline-contract')
  }
  if (admin && commission.stage === 'READY') actions.push('start')
  if (admin && ['READY', 'IN_PROGRESS', 'MAINTENANCE'].includes(commission.stage)) actions.push('save-contract', 'publish-contract')
  if (admin && commission.stage === 'IN_PROGRESS') actions.push('deliver')
  if (commission.stage === 'MAINTENANCE') {
    actions.push('maintenance-feedback')
    if (admin) actions.push('maintenance-resolve', 'close-maintenance')
  }
  return [...new Set(actions)]
}
