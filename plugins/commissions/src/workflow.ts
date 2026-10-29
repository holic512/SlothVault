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
/**
 * 失败、过期或仅完成准备的存证仍占用冻结状态，只有最终确认或显式撤回才解除占用。
 * @param evidence 调用方须保证同一委托至多存在一条未结束的冻结记录；此处只取首条。
 */
export function activeEvidence(evidence: FrozenAction[]): FrozenAction | null { return evidence.find(item => !['FINALIZED', 'WITHDRAWN'].includes(item.status)) ?? null }
/**
 * 汇总角色、阶段及冻结状态允许的动作，不以付款比例推断业务进度。
 * @param pending 调用方需传入当前委托的未结束存证；已提交链上的记录不能通过普通命令撤回。
 * @returns 候选动作；不替代委托访问权限检查及具体命令对输入和业务前置条件的校验。
 */
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
