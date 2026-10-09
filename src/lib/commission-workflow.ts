/**
 * @file commission-workflow.ts
 * @project SlothVault
 * @module Commission Workflow Contract
 * @description Shares lifecycle labels, simple Markdown variables and typed workspace responses.
 * @logic Extract ordered unique variables without executing expressions and render escaped values against frozen field definitions.
 * @dependencies none
 * @index_tags commissions,templates,lifecycle,dto
 * @author holic512
 */
export const WORKFLOW_STAGES = {
  DRAFT: '草稿', REQUESTED: '待接单', ACCEPTED: '已接单', CONTRACT_PENDING: '待合同确认',
  READY: '待启动', IN_PROGRESS: '实施中', MAINTENANCE: '维护中', COMPLETED: '已结束', TERMINATED: '已终止',
} as const
export type WorkflowStage = keyof typeof WORKFLOW_STAGES
export type SimpleField = { key: string; label: string; type: 'text' | 'multiline' | 'number' | 'money' | 'date' | 'select'; required: boolean; defaultValue?: string; options?: string[] }
export const BUSINESS_VARIABLES = ['项目名称', '合同金额', '维护天数', '确认方式'] as const
const namePattern = /^[\p{L}\p{N}_]{1,80}$/u
const reserved = new Set(['__proto__', 'constructor', 'prototype'])

export function extractVariables(markdown: string): string[] {
  if (markdown.length > 100_000) throw new Error('模板正文不能超过 100000 字符')
  const keys: string[] = []
  const remainder = markdown.replace(/{{([^{}]*)}}/g, (_, raw: string) => {
    const key = raw.trim()
    if (!namePattern.test(key) || reserved.has(key)) throw new Error(`变量名称无效：${key}`)
    if (!keys.includes(key)) keys.push(key)
    return ''
  })
  if (remainder.includes('{{') || remainder.includes('}}')) throw new Error('变量括号没有正确闭合')
  if (keys.length > 120) throw new Error('模板最多包含 120 个变量')
  return keys
}
export function synchronizeFields(markdown: string, previous: SimpleField[] = []): SimpleField[] {
  return extractVariables(markdown).map((key) => previous.find((field) => field.key === key) || { key, label: key, type: 'text', required: true })
}
export function renderSimpleTemplate(markdown: string, fields: SimpleField[], values: Record<string, unknown>, strict = false) {
  const expected = extractVariables(markdown)
  if (fields.length !== expected.length || expected.some((key) => fields.filter((field) => field.key === key).length !== 1)) throw new Error('模板变量与字段定义不一致')
  const rendered = new Map<string, string>()
  for (const field of fields) {
    const raw = Object.hasOwn(values, field.key) ? values[field.key] : field.defaultValue
    const empty = raw === undefined || raw === null || raw === ''
    if (empty) {
      if (strict && field.required) throw new Error(`请填写：${field.label}`)
      rendered.set(field.key, field.required ? `【待填写：${field.label}】` : '')
      continue
    }
    if (!['string', 'number'].includes(typeof raw) || String(raw).length > 10_000) throw new Error(`${field.label}内容无效或过长`)
    const value = String(raw)
    if (field.type === 'number' && !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error(`${field.label}必须是数字`)
    if (field.type === 'money' && !/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) throw new Error(`${field.label}须为最多两位小数的非负金额`)
    if (field.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error(`${field.label}日期无效`)
    if (field.type === 'select' && !field.options?.includes(value)) throw new Error(`${field.label}包含无效选项`)
    // Character references remain literal text in Markdown and cannot open HTML attributes.
    rendered.set(field.key, value.replaceAll('\r', '').replace(/[^\p{L}\p{N}\s]/gu, (char) => `&#${char.codePointAt(0)};`).replaceAll('\n', '<br />'))
  }
  const result = markdown.replace(/{{([^{}]*)}}/g, (_, key: string) => rendered.get(key.trim())!)
  if (result.length > 200_000) throw new Error('生成正文过长')
  return result
}

export type SimpleTemplateVersion = { id: string; version: number; status: string; body: string; fields: SimpleField[] }
export type SimpleTemplate = { id: string; name: string; status: string; versions: SimpleTemplateVersion[] }
export type WorkflowFile = { id: string; key: string; name: string; size: string; sha256: string; purpose: string; submitted: boolean; mine: boolean }
export type SnapshotAttachment = { key: string; name: string; size: string; sha256: string; purpose: string }
export type SubmissionSnapshot = {
  protocol: 'slothvault.commission'; version: 1; commissionId: string; eventId: string; sequence: number;
  type: string; submittedAt: string; actor: { role: 'ADMIN' | 'USER' | 'SYSTEM'; name: string; commitment: string; nonce: string };
  note: string; data: Record<string, unknown>; reference: string | null; attachments: SnapshotAttachment[]; previousHash: string | null;
}
export type WorkflowProof = { id: string; network: string; status: string; signature: string | null; blockTime: string | null; error: string | null }
export type WorkflowEvent = { id: string; hash: string; snapshot: SubmissionSnapshot; proofs: WorkflowProof[] }
export type WorkflowAgreement = { id: string; publicId: string; kind: string; status: string; title: string; body: string; template: SimpleTemplateVersion; values: Record<string, unknown>; fileKeys: string[]; totalFen: string | null; maintenanceDays: number; confirmationMode: string; publishedEventId: string | null; confirmedAt: string | null }
export type WorkflowIssue = { id: string; title: string; status: string; resolution: string }
export type WorkflowSummary = { id: string; publicId: string; title: string; subject: string | null; stage: WorkflowStage; paused: boolean; paymentPercent: number; updatedAt: string; bindingStatus: string; nextAction: string; archived: boolean }
export type WorkflowDetail = WorkflowSummary & {
  revision: number; requirements: string; progress: number; totalFen: string | null; confirmationMode: string;
  maintenanceDays: number; maintenanceStartedAt: string | null; maintenanceEndsAt: string | null; maintenanceClosedAt: string | null;
  maintenanceCloseReason: string; events: WorkflowEvent[]; files: WorkflowFile[]; agreements: WorkflowAgreement[];
  issues: WorkflowIssue[]; allowedActions: string[];
}
