/**
 * @file input.ts
 * @project SlothVault
 * @module Commission Command Interfaces
 * @description Validates bounded commands shared by administrator, customer, and MCP adapters.
 * @logic Parse a discriminated operation with a revision and idempotency key; derive actor permissions outside the request body.
 * @dependencies zod, shared commission stages
 * @index_tags commissions,api,commands,validation
 * @author holic512
 */
import { z } from 'zod'
import { COMMISSION_STAGES, MAX_MONEY_FEN } from '@/lib/commissions'
const id = z.coerce.number().int().positive().max(2147483647)
export const moneyInput = z.string().regex(/^\d{1,14}$/).refine((s) => BigInt(s) <= MAX_MONEY_FEN)
const text = z.string().max(10000)
const short = z.string().trim().min(1).max(255)
const date = z.iso.datetime({ offset: true }).nullable().optional()
const party = z.record(z.string().max(40), z.string().max(1000))
export const createCommissionInput = z.object({
  commandId: z.string().uuid(), title: short, purpose: text.min(1), requirements: text.min(1), subjectUserId: id.optional(),
  partyA: party.optional(), quotationFen: moneyInput.optional(),
}).strict()
const base = { commandId: z.string().uuid(), revision: z.number().int().nonnegative() }
const deliveryItem = z.object({ fileId: id.optional(), label: short, url: z.url().max(2000).optional(), versionNote: z.string().max(255).default('') }).strict().refine((v) => Boolean(v.fileId) !== Boolean(v.url), '请选择一个系统文件或外部链接')
export const commissionCommandInput = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('update'), title: short.optional(), purpose: text.optional(), requirements: text.optional(), partyA: party.optional(), partyB: party.optional(), quotationFen: moneyInput.optional() }).strict(),
  z.object({ ...base, action: z.literal('stage'), stage: z.enum(Object.keys(COMMISSION_STAGES) as [keyof typeof COMMISSION_STAGES, ...Array<keyof typeof COMMISSION_STAGES>]), progress: z.number().int().min(0).max(100), note: text, reason: text.default(''), expectedDeliveryAt: date }).strict(),
  z.object({ ...base, action: z.literal('comment'), note: text.min(1) }).strict(),
  z.object({ ...base, action: z.literal('milestone'), id: id.optional(), title: short, description: text, dueAt: date, completed: z.boolean().default(false) }).strict(),
  z.object({ ...base, action: z.literal('payment.submit'), planId: id, amountFen: moneyInput.refine((v) => BigInt(v) > 0n), note: text.min(1), evidenceFileId: id }).strict(),
  z.object({ ...base, action: z.literal('payment.review'), id, approve: z.boolean(), note: text.min(1) }).strict(),
  z.object({ ...base, action: z.literal('payment.record'), planId: id, amountFen: moneyInput.refine((v) => BigInt(v) > 0n), kind: z.enum(['RECEIPT', 'REFUND']), note: text.min(1), evidenceFileId: id.optional() }).strict(),
  z.object({ ...base, action: z.literal('payment.schedule'), planId: id, dueAt: date, basis: text }).strict(),
  z.object({ ...base, action: z.literal('payment.remind'), planId: id, note: text.min(1) }).strict(),
  z.object({ ...base, action: z.literal('change.create'), title: short, original: text.min(1), proposed: text.min(1), reason: text.min(1) }).strict(),
  z.object({ ...base, action: z.literal('change.quote'), id, feeFen: moneyInput, extensionDays: z.number().int().min(0).max(36500), impact: text.min(1) }).strict(),
  z.object({ ...base, action: z.literal('issue.create'), title: short, deliveryId: id.optional(), kind: z.enum(['BUG', 'ADJUSTMENT', 'NEW_WORK']), severity: z.enum(['SEVERE', 'GENERAL', 'MINOR']), steps: text.min(1), expected: text.min(1), actual: text.min(1), fileIds: z.array(id).max(20).default([]), dueAt: date }).strict(),
  z.object({ ...base, action: z.literal('issue.update'), id, status: z.enum(['OPEN', 'RESOLVED', 'CLOSED', 'DISPUTED']), resolution: text.min(1), kind: z.enum(['BUG', 'ADJUSTMENT', 'NEW_WORK']).optional(), dueAt: date }).strict(),
  z.object({ ...base, action: z.literal('delivery.create'), version: short, kind: z.enum(['DEMO', 'FINAL']), note: text, testInstructions: text, items: z.array(deliveryItem).min(1).max(100) }).strict(),
  z.object({ ...base, action: z.literal('delivery.update'), id, version: short, kind: z.enum(['DEMO', 'FINAL']), note: text, testInstructions: text, items: z.array(deliveryItem).min(1).max(100) }).strict(),
  z.object({ ...base, action: z.literal('delivery.publish'), id }).strict(),
  z.object({ ...base, action: z.literal('delivery.receive'), id, received: z.boolean(), note: text }).strict(),
  z.object({ ...base, action: z.literal('acceptance.create'), deliveryId: id, result: z.enum(['PASS', 'CONDITIONAL', 'FAIL']), basis: text.min(1), outstanding: text }).strict(),
  z.object({ ...base, action: z.literal('acceptance.remind'), id, note: text.min(1) }).strict(),
  z.object({ ...base, action: z.literal('acceptance.deem'), id, basis: text.min(20) }).strict(),
  z.object({ ...base, action: z.literal('settlement'), completedWork: text.min(1), payableFen: moneyInput, refundableFen: moneyInput, intellectualProperty: text.min(1), resources: text.min(1), note: text }).strict(),
])
export type CommissionCommand = z.infer<typeof commissionCommandInput>
export type CommissionActor = { userId: number; isAdmin: boolean; sessionId?: string; ip?: string; userAgent?: string | null }
export const documentDraftInput = z.object({ ...base, templateVersionId: id, documentType: z.enum(['AGREEMENT', 'CHANGE', 'ACCEPTANCE']), sourceRecordId: id.optional(), values: z.record(z.string(), z.unknown()), documentId: id.optional(), attachmentFileIds: z.array(id).max(100).optional() }).strict()
export const settingsInput = z.object({ provider: party, calendar: z.object({ holidays: z.array(z.iso.date()).max(1000), workdays: z.array(z.iso.date()).max(1000) }).strict() }).strict()
