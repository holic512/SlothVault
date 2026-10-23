/**
 * @file presentation.ts
 * @project SlothVault
 * @module Commission presentation contracts
 * @description Shared navigation and template defaults for stage-based plugin pages.
 * @logic Use real host extension routes and populate only known, type-compatible values.
 * @dependencies Commission DTOs and template field compatibility
 * @index_tags commissions,navigation,templates
 * @author holic512
 */
import type { CommissionDetail, ContractDraft, ContractTemplate, FieldValue } from './domain'
export const endpoint = (path: string, params: Record<string, string | number | undefined> = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))
  return `${path}${query.size ? `?${query}` : ''}`
}
export const pageUrl = (admin: boolean, page = admin ? 'admin' : 'account', params: Record<string, string> = {}) => endpoint(`${admin ? '/admin/mm' : '/account'}/extensions/slothvault.commissions/${page}`, params)
import { renderTemplate as renderBody } from './templates'
export { renderTemplate as renderBody } from './templates'
export function initialDraft(detail: CommissionDetail, template?: ContractTemplate): ContractDraft {
  if (!template) return { templateId: '', kind: 'MAIN', title: `${detail.commission.title}委托合同`, fields: {}, body: '' }
  const main = detail.commission.contracts.find(contract => contract.kind === 'MAIN' && contract.effectiveAt)
  const known: Record<string, FieldValue | undefined> = { ...detail.contractDefaults, projectName: detail.commission.title, maintenanceDays: detail.commission.maintenanceDays, baseContractId: main?.id }
  const fields: Record<string, FieldValue> = {}
  for (const field of template.fields) {
    if (field.default !== undefined) fields[field.key] = field.default
    const value = known[field.semantic]
    if (value !== undefined && typeof value === field.type) fields[field.key] = value
  }
  return { templateId: template.id, kind: template.kind, title: `${detail.commission.title}${template.kind === 'SUPPLEMENT' ? '补充协议' : '委托合同'}`, fields, body: renderBody(template, fields) }
}
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const messages: Record<string, string> = {
    WALLET_CANCELLED: '已取消钱包连接，冻结内容仍然保留；准备好后可继续办理。',
    WALLET_DISCONNECTED: '钱包已断开，请重新连接管理员钱包。',
    WALLET_CHANGED: '钱包账户发生变化，请切回准备存证时使用的管理员账户。',
    WALLET_CONNECTION_FAILED: '钱包连接失败，请检查钱包扩展后重试。',
    WALLET_BUSY: '另一项钱包操作仍在进行，请先完成或取消该操作。',
    STALE_REVISION: '委托已被其他操作更新，请刷新详情后重新核对；不要重复提交旧内容。',
    STALE_TEMPLATE_VERSION: '模板已有新版本，请刷新模板库后再修订。',
    ACTION_NOT_ALLOWED: '当前阶段或权限不允许此操作，请返回委托核对当前待办。',
    IDEMPOTENCY_CONFLICT: '本次操作标识与已提交内容不一致，请刷新并核对已有结果。',
    ATTACHMENT_INTEGRITY_FAILURE: '附件校验失败，已停止办理；请联系管理员核对原始文件。',
    FROZEN_CONTENT_INTEGRITY_FAILURE: '冻结记录校验失败，已停止推进；请联系管理员检查数据完整性。',
    MISSING_FIELDS: '合同资料尚未填写完整，请返回条款步骤检查必填项。',
  }
  const message = messages[text.split(':')[0]]
  if (message) return message
  if (/reject|denied|cancel/i.test(text)) return '钱包操作未获确认，内容仍然保留。可重新办理；若已提交交易，请先核对原交易。'
  if (/insufficient|balance/i.test(text)) return '钱包余额不足，请补足主网手续费后重试。冻结内容不会丢失。'
  if (/timeout|network|fetch/i.test(text)) return '网络请求未完成，请稍后重试；若已广播交易，请先核对原交易状态。'
  return /[\u3400-\u9fff]/.test(text) ? text : '操作未完成，请刷新详情核对阶段、资料和权限后重试。已保存内容会保留。'
}
