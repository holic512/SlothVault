/**
 * @file backup.ts
 * @project SlothVault
 * @module Portable Commission Backup
 * @description Defines portable commission collections and remaps their private relational identities during restore.
 * @logic Validate every scalar, create parents before children, retain immutable document snapshots, and delete dependants in reverse order.
 * @dependencies Prisma transactions, Zod, shared commission rules
 * @index_tags commissions,backup,restore,portability
 * @author holic512
 */
import 'server-only'
import { z } from 'zod'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { moneyInput } from './input'
import { workflowBackupShape, workflowCollectionSpecs, validateWorkflowBackup } from './workflow-backup'
import { WORKFLOW_STAGES, renderSimpleTemplate } from '@/lib/commission-workflow'
import { COMMISSION_STAGES } from '@/lib/commissions'
import { validateTemplateDefinition, validateTemplateValues } from '@/lib/contract-template'
import { templateVersionInput } from './templates'
import { assertDeliveryManifest } from './storage'
const idSchema = z.string().regex(/^[1-9]\d*$/).refine((id) => BigInt(id) <= 2147483647n)
export const commissionBackupShape = {
  ...workflowBackupShape,
  commissionTemplates: z.array(z.object({
    id: idSchema,
    key: z.string().max(10000),
    name: z.string().max(10000),
    status: z.string().max(10000),
    createdAt: z.iso.datetime({ offset: true }),
  }).strict()).max(100000).default([]),
  commissionTemplateVersions: z.array(z.object({
    id: idSchema,
    templateId: idSchema,
    format: z.enum(['LEGACY', 'SIMPLE']).default('LEGACY'),
    version: z.number().int().min(0).max(1000000),
    status: z.string().max(10000),
    documentsJson: z.string().max(500000),
    fieldsJson: z.string().max(500000),
    defaultsJson: z.string().max(500000),
    createdAt: z.iso.datetime({ offset: true }),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
  }).strict()).max(100000).default([]),
  commissionSettings: z.array(z.object({
    id: idSchema,
    providerJson: z.string().max(500000),
    calendarJson: z.string().max(500000),
  }).strict()).max(100000).default([]),
  commissions: z.array(z.object({
    id: idSchema,
    commissionId: z.string().max(10000),
    subjectUserId: idSchema.nullable(),
    workflowVersion: z.number().int().min(1).max(2).default(1),
    paused: z.boolean().default(false),
    paymentPercent: z.number().int().min(0).max(100).default(0),
    confirmationMode: z.enum(['ONLINE', 'OFFLINE']).default('ONLINE'),
    maintenanceStartedAt: z.iso.datetime({ offset: true }).nullable().default(null),
    maintenanceEndsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    maintenanceClosedAt: z.iso.datetime({ offset: true }).nullable().default(null),
    maintenanceCloseReason: z.string().max(1000).default(''),
    title: z.string().max(10000),
    purpose: z.string().max(10000),
    requirements: z.string().max(10000),
    partyAJson: z.string().max(500000),
    partyBJson: z.string().max(500000),
    quotationFen: moneyInput.nullable(),
    agreementFen: moneyInput.nullable(),
    stage: z.enum(Object.keys({ ...COMMISSION_STAGES, ...WORKFLOW_STAGES }) as [string, ...string[]]),
    progress: z.number().int().min(0).max(1000000),
    progressNote: z.string().max(10000),
    revision: z.number().int().min(0).max(1000000),
    expectedDeliveryAt: z.iso.datetime({ offset: true }).nullable(),
    startedAt: z.iso.datetime({ offset: true }).nullable(),
    acceptedAt: z.iso.datetime({ offset: true }).nullable(),
    adjustmentDays: z.number().int().min(0).max(1000000),
    maintenanceDays: z.number().int().min(0).max(1000000),
    settlementJson: z.string().max(500000),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  }).strict()).max(100000).default([]),
  commissionMilestones: z.array(z.object({
    id: idSchema,
    commissionId: idSchema,
    title: z.string().max(10000),
    description: z.string().max(10000),
    dueAt: z.iso.datetime({ offset: true }).nullable(),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
  }).strict()).max(100000).default([]),
  commissionPlans: z.array(z.object({
    id: idSchema,
    commissionId: idSchema,
    key: z.string().max(10000),
    kind: z.string().max(10000),
    title: z.string().max(10000),
    amountFen: moneyInput,
    dueAt: z.iso.datetime({ offset: true }).nullable(),
    basis: z.string().max(10000),
    remindedAt: z.iso.datetime({ offset: true }).nullable(),
  }).strict()).max(100000).default([]),
  commissionFiles: z.array(z.object({
    id: idSchema,
    commissionId: idSchema,
    fileId: idSchema,
    purpose: z.string().max(10000),
    sha256: z.string().max(10000),
    uploaderUserId: idSchema,
    shared: z.boolean(),
  }).strict()).max(100000).default([]),
  commissionChanges: z.array(z.object({
    id: idSchema,
    commissionId: idSchema,
    title: z.string().max(10000),
    original: z.string().max(10000),
    proposed: z.string().max(10000),
    reason: z.string().max(10000),
    impact: z.string().max(10000),
    feeFen: moneyInput,
    extensionDays: z.number().int().min(0).max(1000000),
    status: z.string().max(10000),
    createdById: idSchema,
    createdAt: z.iso.datetime({ offset: true }),
    confirmedAt: z.iso.datetime({ offset: true }).nullable(),
  }).strict()).max(100000).default([]),
  commissionDeliveries: z.array(z.object({
    id: idSchema,
    commissionId: idSchema,
    version: z.string().max(10000),
    kind: z.string().max(10000),
    note: z.string().max(10000),
    testInstructions: z.string().max(10000),
    manifestJson: z.string().max(500000),
    status: z.enum(['DRAFT','PUBLISHED','RECEIVED','INCOMPLETE']),
    createdAt: z.iso.datetime({ offset: true }),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
    receivedAt: z.iso.datetime({ offset: true }).nullable(),
    receiptNote: z.string().max(10000),
  }).strict()).max(100000).default([]),
  commissionDeliveryItems: z.array(z.object({
    id: idSchema,
    deliveryId: idSchema,
    fileId: idSchema.nullable(),
    label: z.string().max(10000),
    url: z.string().max(10000).nullable(),
    versionNote: z.string().max(10000),
  }).strict()).max(100000).default([]),
  commissionIssues: z.array(z.object({
    id: idSchema,
    commissionId: idSchema,
    deliveryId: idSchema.nullable(),
    title: z.string().max(10000),
    kind: z.string().max(10000),
    severity: z.string().max(10000),
    status: z.string().max(10000),
    steps: z.string().max(10000),
    expected: z.string().max(10000),
    actual: z.string().max(10000),
    resolution: z.string().max(10000),
    fileIdsJson: z.string().max(500000),
    dueAt: z.iso.datetime({ offset: true }).nullable(),
    createdById: idSchema,
    createdAt: z.iso.datetime({ offset: true }),
    resolvedAt: z.iso.datetime({ offset: true }).nullable(),
  }).strict()).max(100000).default([]),
  commissionAcceptances: z.array(z.object({
    id: idSchema,
    commissionId: idSchema,
    deliveryId: idSchema,
    result: z.string().max(10000),
    basis: z.string().max(10000),
    outstanding: z.string().max(10000),
    status: z.string().max(10000),
    createdAt: z.iso.datetime({ offset: true }),
    confirmedAt: z.iso.datetime({ offset: true }).nullable(),
    remindedAt: z.iso.datetime({ offset: true }).nullable(),
    supplementalDueAt: z.iso.datetime({ offset: true }).nullable(),
    deemedBasis: z.string().max(10000).nullable(),
  }).strict()).max(100000).default([]),
  commissionPayments: z.array(z.object({
    id: idSchema,
    commissionId: idSchema,
    planId: idSchema,
    amountFen: moneyInput,
    kind: z.enum(['RECEIPT','REFUND']),
    status: z.enum(['PENDING','CONFIRMED','REJECTED']),
    note: z.string().max(10000),
    evidenceFileId: idSchema.nullable(),
    createdById: idSchema,
    confirmedById: idSchema.nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    confirmedAt: z.iso.datetime({ offset: true }).nullable(),
  }).strict()).max(100000).default([]),
  commissionEvents: z.array(z.object({
    id: idSchema,
    commissionId: idSchema,
    actorUserId: idSchema,
    commandId: z.string().max(10000),
    type: z.string().max(10000),
    note: z.string().max(10000),
    dataJson: z.string().max(500000),
    createdAt: z.iso.datetime({ offset: true }),
  }).strict()).max(100000).default([]),
} as const
export const commissionCollectionSpecs = [
  {
    "key": "commissionTemplates",
    "delegate": "contractTemplate",
    "refs": {},
    "dates": [
      "createdAt"
    ],
    "money": []
  },
  {
    "key": "commissionTemplateVersions",
    "delegate": "contractTemplateVersion",
    "refs": {
      "templateId": "commissionTemplates"
    },
    "dates": [
      "createdAt",
      "publishedAt"
    ],
    "money": []
  },
  {
    "key": "commissionSettings",
    "delegate": "commissionSettings",
    "refs": {},
    "dates": [],
    "money": []
  },
  {
    "key": "commissions",
    "delegate": "commission",
    "refs": {
      "subjectUserId": "users"
    },
    "dates": [
      "maintenanceStartedAt",
      "maintenanceEndsAt",
      "maintenanceClosedAt",
      "expectedDeliveryAt",
      "startedAt",
      "acceptedAt",
      "createdAt",
      "updatedAt"
    ],
    "money": [
      "quotationFen",
      "agreementFen"
    ]
  },
  {
    "key": "commissionMilestones",
    "delegate": "commissionMilestone",
    "refs": {
      "commissionId": "commissions"
    },
    "dates": [
      "dueAt",
      "completedAt"
    ],
    "money": []
  },
  {
    "key": "commissionPlans",
    "delegate": "commissionPaymentPlan",
    "refs": {
      "commissionId": "commissions"
    },
    "dates": [
      "dueAt",
      "remindedAt"
    ],
    "money": [
      "amountFen"
    ]
  },
  {
    "key": "commissionFiles",
    "delegate": "commissionFile",
    "refs": {
      "commissionId": "commissions",
      "fileId": "fileManagements",
      "uploaderUserId": "users"
    },
    "dates": [],
    "money": []
  },
  {
    "key": "commissionChanges",
    "delegate": "commissionChange",
    "refs": {
      "commissionId": "commissions",
      "createdById": "users"
    },
    "dates": [
      "createdAt",
      "confirmedAt"
    ],
    "money": [
      "feeFen"
    ]
  },
  {
    "key": "commissionDeliveries",
    "delegate": "commissionDelivery",
    "refs": {
      "commissionId": "commissions"
    },
    "dates": [
      "createdAt",
      "publishedAt",
      "receivedAt"
    ],
    "money": []
  },
  {
    "key": "commissionDeliveryItems",
    "delegate": "commissionDeliveryItem",
    "refs": {
      "deliveryId": "commissionDeliveries",
      "fileId": "commissionFiles"
    },
    "dates": [],
    "money": []
  },
  {
    "key": "commissionIssues",
    "delegate": "commissionIssue",
    "refs": {
      "commissionId": "commissions",
      "deliveryId": "commissionDeliveries",
      "createdById": "users"
    },
    "dates": [
      "dueAt",
      "createdAt",
      "resolvedAt"
    ],
    "money": []
  },
  {
    "key": "commissionAcceptances",
    "delegate": "commissionAcceptance",
    "refs": {
      "commissionId": "commissions",
      "deliveryId": "commissionDeliveries"
    },
    "dates": [
      "createdAt",
      "confirmedAt",
      "remindedAt",
      "supplementalDueAt"
    ],
    "money": []
  },
  {
    "key": "commissionPayments",
    "delegate": "commissionPayment",
    "refs": {
      "commissionId": "commissions",
      "planId": "commissionPlans",
      "evidenceFileId": "commissionFiles",
      "createdById": "users",
      "confirmedById": "users"
    },
    "dates": [
      "createdAt",
      "confirmedAt"
    ],
    "money": [
      "amountFen"
    ]
  },
  {
    "key": "commissionEvents",
    "delegate": "commissionEvent",
    "refs": {
      "commissionId": "commissions",
      "actorUserId": "users"
    },
    "dates": [
      "createdAt"
    ],
    "money": []
  }
, ...workflowCollectionSpecs
] as const
export const commissionCollectionKeys = commissionCollectionSpecs.map((s) => s.key)
type Row = Record<string, unknown> & { id: string }
type Delegate = { findMany(): Promise<Array<Record<string, unknown>>>; findUnique(input: object): Promise<(Record<string, unknown> & { id: number }) | null>; upsert(input: object): Promise<{ id: number }>; create(input: { data: Record<string, unknown> }): Promise<{ id: number }>; deleteMany(input: object): Promise<{ count: number }> }
function delegate(tx: Prisma.TransactionClient, key: string) { return (tx as unknown as Record<string, Delegate>)[key] }
export async function exportCommissionCollections(tx: Prisma.TransactionClient) {
  const result: Record<string, Array<Record<string, unknown>>> = {}
  for (const spec of commissionCollectionSpecs) {
    result[spec.key] = (await delegate(tx, spec.delegate).findMany()).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : typeof value === 'bigint' || (typeof value === 'number' && (key === 'id' || Object.hasOwn(spec.refs, key))) ? String(value) : value])))
  }
  return result
}
export async function importCommissionCollections(tx: Prisma.TransactionClient, data: Record<string, unknown>, maps: Record<string, Map<string, number>>, parents: boolean) {
  const counts: Record<string, number> = {}
  for (const spec of commissionCollectionSpecs) {
    const isParent = ['commissionTemplates','commissionTemplateVersions','commissionSettings','commissions'].includes(spec.key)
    if (isParent !== parents) continue
    const index = maps[spec.key] ||= new Map<string, number>()
    for (const source of (data[spec.key] || []) as Row[]) {
      const { id, ...row } = source
      for (const [field, collection] of Object.entries(spec.refs)) if (row[field] !== null && row[field] !== undefined) { const mapped = maps[collection]?.get(String(row[field])); if (!mapped) throw new Error(`Missing validated commission reference: ${collection}`); row[field] = mapped }
      for (const field of spec.dates) if (row[field]) row[field] = new Date(String(row[field]))
      for (const field of spec.money) if (row[field] !== null) row[field] = BigInt(String(row[field]))
      if (spec.key === 'commissionIssues') row.fileIdsJson = JSON.stringify((JSON.parse(String(row.fileIdsJson)) as Array<string | number>).map((fileId) => { const mapped = maps.commissionFiles.get(String(fileId)); if (!mapped) throw new Error('Missing issue file reference'); return mapped }))
      if (spec.key === 'commissionDeliveries') row.manifestJson = JSON.stringify((JSON.parse(String(row.manifestJson)) as Array<Record<string,unknown>>).map((entry) => ({ ...entry, fileId: entry.fileId ? maps.commissionFiles.get(String(entry.fileId)) : null })))
      if (spec.key === 'commissionSettings') row.id = 1
      let record: { id: number }
      if (spec.key === 'commissionTemplates') {
        const existing = await delegate(tx, spec.delegate).findUnique({ where: { key: row.key } })
        record = existing || await delegate(tx, spec.delegate).create({ data: row })
      } else if (spec.key === 'commissionTemplateVersions') {
        const existing = await delegate(tx, spec.delegate).findUnique({ where: { templateId_version: { templateId: row.templateId, version: row.version } } })
        if (existing && ['documentsJson', 'fieldsJson', 'defaultsJson', 'status'].some((key) => existing[key] !== row[key])) throw new Error('同名模板版本内容冲突，不能覆盖已存在版本')
        record = existing || await delegate(tx, spec.delegate).create({ data: row })
      } else if (spec.key === 'commissionSettings') record = await delegate(tx, spec.delegate).upsert({ where: { id: 1 }, create: row, update: row })
      else record = await delegate(tx, spec.delegate).create({ data: row })
      index.set(id, record.id)
    }
    counts[spec.key] = index.size
  }
  return counts
}
export async function deleteCommissionCollections(tx: Prisma.TransactionClient, parents: boolean) {
  const counts: Record<string, number> = {}
  for (const spec of [...commissionCollectionSpecs].reverse()) {
    const isParent = ['commissionTemplates','commissionTemplateVersions','commissionSettings','commissions'].includes(spec.key)
    if (isParent !== parents) continue
    counts[spec.key] = (await delegate(tx, spec.delegate).deleteMany({})).count
  }
  return counts
}
export function validateCommissionBackup(data: Record<string, unknown>) {
  validateWorkflowBackup(data)
  const indexes = Object.fromEntries(Object.entries(data).filter(([,v]) => Array.isArray(v)).map(([key,rows]) => [key, new Map((rows as Row[]).map((r) => [r.id, r]))]))
  for (const spec of commissionCollectionSpecs) {
    const rows = (data[spec.key] || []) as Row[]
    if (indexes[spec.key]?.size !== rows.length) throw new Error(`Duplicate commission backup IDs: ${spec.key}`)
    for (const row of rows) {
      for (const [field, collection] of Object.entries(spec.refs)) if (row[field] !== null && !indexes[collection]?.has(String(row[field]))) throw new Error(`Unknown commission reference: ${spec.key}.${field}`)
      if (row.commissionId && typeof row.commissionId === 'string' && spec.key !== 'commissions') {
        for (const field of ['planId','evidenceFileId','deliveryId']) {
          const target = Object.hasOwn(spec.refs, field) ? indexes[(spec.refs as Record<string,string>)[field]]?.get(String(row[field])) : undefined
          if (target && target.commissionId !== row.commissionId) throw new Error('Commission backup crosses customer boundaries')
        }
      }
      for (const [key,value] of Object.entries(row)) if (key.endsWith('Json') && typeof value === 'string') JSON.parse(value)
      if (spec.key === 'commissionTemplateVersions' && row.format === 'SIMPLE') {
        renderSimpleTemplate(JSON.parse(String(row.documentsJson)).body, JSON.parse(String(row.fieldsJson)), {})
      }
      if (spec.key === 'commissionTemplateVersions' && row.format !== 'SIMPLE') {
        const definition = templateVersionInput.parse({ documents: JSON.parse(String(row.documentsJson)), fields: JSON.parse(String(row.fieldsJson)), defaults: JSON.parse(String(row.defaultsJson)) })
        validateTemplateDefinition(definition.documents, definition.fields)
        for (const kind of ['AGREEMENT', 'CHANGE', 'ACCEPTANCE'] as const) validateTemplateValues(definition.fields, definition.defaults, kind, false)
      }
      if (spec.key === 'commissionFiles') {
        const file = indexes.fileManagements?.get(String(row.fileId))
        if (!file || file.businessType !== 'CommissionAttachment' || !/^uploads\/commission-attachment\/[\w-]+\.[a-z0-9]+$/.test(String(file.filePath)) || !/^[a-f0-9]{64}$/.test(String(row.sha256))) throw new Error('Private commission file metadata is invalid')
        if (row.purpose === 'DELIVERY' && row.shared && indexes.commissions?.get(String(row.commissionId))?.workflowVersion !== 2) throw new Error('Delivery drafts must remain private')
      }
      if (spec.key === 'commissionDeliveryItems') {
        const delivery = indexes.commissionDeliveries?.get(String(row.deliveryId)), file = row.fileId ? indexes.commissionFiles?.get(String(row.fileId)) : null
        if (file && delivery?.commissionId !== file.commissionId) throw new Error('Delivery file crosses commission boundaries')
        if (Boolean(row.fileId) === Boolean(row.url)) throw new Error('Delivery item must have one source')
        if (row.url) { const url = new URL(String(row.url)); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !String(row.versionNote).trim()) throw new Error('External delivery resource is invalid') }
      }
      if (spec.key === 'commissionIssues') {
        const files = JSON.parse(String(row.fileIdsJson))
        if (!Array.isArray(files) || files.length > 20 || files.some((id) => indexes.commissionFiles?.get(String(id))?.commissionId !== row.commissionId)) throw new Error('Issue files cross commission boundaries')
      }
      if (spec.key === 'commissionPayments' && row.status === 'CONFIRMED' && (!row.confirmedById || !row.confirmedAt)) throw new Error('Confirmed payments need an administrator audit')
    }
  }
  const stateFields = { commissionTemplates: { status: ['ACTIVE', 'RETIRED'] }, commissionTemplateVersions: { status: ['DRAFT', 'PUBLISHED'] }, commissionPayments: { status: ['PENDING', 'CONFIRMED', 'REJECTED'], kind: ['RECEIPT', 'REFUND'] }, commissionChanges: { status: ['PROPOSED', 'QUOTED', 'PENDING_SIGNATURE', 'CONFIRMED', 'REJECTED'] }, commissionFiles: { purpose: ['REQUIREMENT', 'PAYMENT', 'TEST', 'DELIVERY', 'CONTRACT'] }, commissionDeliveries: { status: ['DRAFT', 'PUBLISHED', 'RECEIVED', 'INCOMPLETE'], kind: ['DEMO', 'FINAL'] }, commissionIssues: { status: ['OPEN', 'RESOLVED', 'CLOSED', 'DISPUTED'], kind: ['BUG', 'ADJUSTMENT', 'NEW_WORK'], severity: ['SEVERE', 'GENERAL', 'MINOR'] }, commissionAcceptances: { status: ['DRAFT', 'SUBMITTED', 'CONFIRMED', 'DEEMED', 'REJECTED', 'CANCELLED'], result: ['PASS', 'CONDITIONAL', 'FAIL'] } }
  for (const [collection, fields] of Object.entries(stateFields)) for (const row of (data[collection] || []) as Row[]) for (const [key, allowed] of Object.entries(fields)) if (!allowed.includes(String(row[key]))) throw new Error(`Invalid commission state: ${collection}.${key}`)
  for (const plan of (data.commissionPlans || []) as Row[]) {
    const entries = ((data.commissionPayments || []) as Row[]).filter((p) => p.planId === plan.id && p.status === 'CONFIRMED')
    const net = entries.reduce((sum, p) => sum + (p.kind === 'REFUND' ? -1n : 1n) * BigInt(String(p.amountFen)), 0n)
    if (net < 0n) throw new Error('Commission refunds exceed confirmed receipts')
  }
  for (const delivery of (data.commissionDeliveries || []) as Row[]) {
    if ((delivery.status === 'DRAFT') !== (delivery.publishedAt === null)) throw new Error('Delivery publication metadata is invalid')
    const items = ((data.commissionDeliveryItems || []) as Row[]).filter((i) => i.deliveryId === delivery.id).sort((a, b) => Number(a.id) - Number(b.id)).map((i) => ({ fileId: i.fileId ? Number(i.fileId) : null, label: String(i.label), url: i.url ? String(i.url) : null, versionNote: String(i.versionNote) }))
    const files = ((data.commissionFiles || []) as Row[]).filter((f) => f.commissionId === delivery.commissionId).map((f) => { const metadata = indexes.fileManagements.get(String(f.fileId))!; return { id: Number(f.id), sha256: String(f.sha256), file: { originalName: String(metadata.originalName), fileSize: BigInt(String(metadata.fileSize)) } } })
    assertDeliveryManifest({ publishedAt: delivery.publishedAt ? new Date(String(delivery.publishedAt)) : null, manifestJson: String(delivery.manifestJson), items }, files)
  }
}
