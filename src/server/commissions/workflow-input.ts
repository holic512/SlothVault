/**
 * @file workflow-input.ts
 * @project SlothVault
 * @module Commission Workflow Inputs
 * @description Validates explicit workflow commands and bounded simple templates.
 * @logic Keep authentication outside request data and reject unknown command properties.
 * @dependencies zod
 * @index_tags commissions,validation,commands
 * @author holic512
 */
import { z } from 'zod'
import { moneyInput } from './input'
const id = z.coerce.number().int().positive().max(2147483647)
const note = z.string().trim().max(10000)
const title = z.string().trim().min(1).max(255)
const keys = z.array(z.string().max(100)).max(100).refine((items) => new Set(items).size === items.length, '附件不能重复')
const base = { commandId: z.string().uuid(), revision: z.number().int().nonnegative() }
const files = { fileKeys: keys.default([]), reference: z.string().uuid().optional() }
export const workflowCreateInput = z.object({ commandId: z.string().uuid(), title, requirements: note.default(''), subjectUserId: id.optional(), draft: z.boolean().default(false) }).strict()
export const simpleFieldInput = z.object({ key: z.string().min(1).max(80), label: z.string().min(1).max(100), type: z.enum(['text', 'multiline', 'number', 'money', 'date', 'select']), required: z.boolean(), defaultValue: z.string().max(10000).optional(), options: z.array(z.string().min(1).max(200)).max(100).optional() }).strict()
export const simpleVersionInput = z.object({ body: z.string().min(1).max(100000), fields: z.array(simpleFieldInput).max(120), versionId: id.optional() }).strict()
export const workflowCommandInput = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('draft.update'), title, requirements: note }).strict(),
  z.object({ ...base, action: z.literal('request.submit'), note: note.min(1), ...files }).strict(),
  z.object({ ...base, action: z.literal('request.accept') }).strict(),
  z.object({ ...base, action: z.literal('request.return'), note: note.min(1) }).strict(),
  z.object({ ...base, action: z.literal('submission.create'), kind: z.enum(['REQUIREMENT', 'COMMENT', 'PROGRESS', 'DEMO', 'REPAIR']), note: note.min(1), progress: z.number().int().min(0).max(100).optional(), ...files }).strict(),
  z.object({ ...base, action: z.literal('payment.update'), percent: z.number().int().min(0).max(100), note, ...files }).strict(),
  z.object({ ...base, action: z.literal('agreement.save'), id: id.optional(), templateVersionId: id, kind: z.enum(['AGREEMENT', 'SUPPLEMENT']).default('AGREEMENT'), title, values: z.record(z.string().max(80), z.union([z.string().max(10000), z.number()])), fileKeys: keys.default([]), totalFen: moneyInput.nullable(), maintenanceDays: z.number().int().min(1).max(3650).default(15), confirmationMode: z.enum(['ONLINE', 'OFFLINE']).default('ONLINE') }).strict(),
  z.object({ ...base, action: z.literal('agreement.publish'), id }).strict(),
  z.object({ ...base, action: z.literal('agreement.confirm'), id, eventId: z.string().uuid() }).strict(),
  z.object({ ...base, action: z.literal('agreement.decline'), id, eventId: z.string().uuid(), note: note.min(1) }).strict(),
  z.object({ ...base, action: z.literal('agreement.offline'), id, eventId: z.string().uuid(), confirmedAt: z.iso.datetime({ offset: true }), note: note.min(1), fileKeys: keys.min(1) }).strict(),
  z.object({ ...base, action: z.literal('project.start') }).strict(),
  z.object({ ...base, action: z.literal('project.pause'), paused: z.boolean(), note: note.min(1) }).strict(),
  z.object({ ...base, action: z.literal('project.terminate'), note: note.min(1) }).strict(),
  z.object({ ...base, action: z.literal('delivery.publish'), note: note.min(1), fileKeys: keys.min(1), links: z.array(z.url().max(2000).refine((url) => { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password })).max(20).default([]) }).strict(),
  z.object({ ...base, action: z.literal('issue.create'), title, note: note.min(1), ...files }).strict(),
  z.object({ ...base, action: z.literal('issue.update'), issueId: z.string().uuid(), status: z.enum(['OPEN', 'RESOLVED', 'CLOSED']), note: note.min(1), ...files }).strict(),
  z.object({ ...base, action: z.literal('maintenance.close'), note }).strict(),
])
export type WorkflowCommand = z.infer<typeof workflowCommandInput>
