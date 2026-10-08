/**
 * @file commissions.ts
 * @project SlothVault
 * @module Commission Public DTOs
 * @description Shares template form definitions and private commission workspace data across browser and server.
 * @logic Transport identifiers and exact money as strings, expose immutable document snapshots, and keep signature request metadata administrator-only.
 * @dependencies lib/commissions
 * @index_tags commissions,templates,dto,interfaces
 * @author holic512
 */
import type { CommissionDocumentType, CommissionStage } from '@/lib/commissions'
export type TemplateField = {
  key: string; label: string; type: 'text' | 'multiline' | 'date' | 'money' | 'number' | 'select' | 'multiselect' | 'boolean' | 'rows'
  required?: boolean; documents?: CommissionDocumentType[]; options?: Array<{ value: string; label: string }>
  fields?: TemplateField[]; when?: { key: string; value: string }; help?: string
}
export type TemplateDocuments = { AGREEMENT: string; REQUIREMENTS: string; CHANGE: string; ACCEPTANCE: string }
export type TemplateVersionDto = {
  id: string; templateId: string; version: number; status: string; publishedAt: string | null
  documents: TemplateDocuments; fields: TemplateField[]; defaults: Record<string, unknown>
}
export type TemplateDto = { id: string; key: string; name: string; status: string; versions: TemplateVersionDto[] }
export type PartyFields = Record<string, string>
export type CommissionDocumentDto = {
  id: string; contractId: string; snapshotHash: string | null; title: string; documentType: CommissionDocumentType; status: number; body: string; bodyHash: string
  contractHash: string | null; issuedAt: string | null; signedAt: string | null; declinedAt: string | null
  declineReason: string | null; templateVersionId: string | null; sourceRecordId: string | null
  attachment: { id: string; originalName: string } | null; values: Record<string, unknown>
  credentials: Array<{ id: string; network: string; status: number; transactionSignature: string | null }>
  associatedFiles: Array<{ id: string; originalName: string; fileSize: string; sha256: string }>
  providerAccount: string; customerAccount: string
}
export type CommissionFileDto = { id: string; purpose: string; sha256: string; uploaderUserId: string; shared: boolean; originalName: string; fileSize: string; createdAt: string }
export type DeliveryItemDto = { id: string; fileId: string | null; label: string; url: string | null; versionNote: string }
export type CommissionDeliveryDto = { id: string; version: string; kind: string; note: string; testInstructions: string; status: string; publishedAt: string | null; receivedAt: string | null; receiptNote: string; items: DeliveryItemDto[] }
export type CommissionPlanDto = { id: string; key: string; kind: string; title: string; amountFen: string; dueAt: string | null; basis: string; remindedAt: string | null; receivedFen: string; refundedFen: string; netFen: string; remainingFen: string; status: string }
export type CommissionPaymentDto = { id: string; planId: string; amountFen: string; kind: string; status: string; note: string; evidenceFileId: string | null; createdAt: string; confirmedAt: string | null }
export type CommissionChangeDto = { id: string; title: string; original: string; proposed: string; reason: string; impact: string; feeFen: string; extensionDays: number; status: string; createdAt: string; confirmedAt: string | null }
export type CommissionIssueDto = { id: string; title: string; deliveryId: string | null; kind: string; severity: string; status: string; steps: string; expected: string; actual: string; resolution: string; fileIds: string[]; dueAt: string | null; createdAt: string }
export type CommissionAcceptanceDto = { id: string; deliveryId: string; result: string; basis: string; outstanding: string; status: string; createdAt: string; confirmedAt: string | null; remindedAt: string | null; supplementalDueAt: string | null; deemedBasis: string | null }
export type CommissionDetail = {
  id: string; commissionId: string; title: string; purpose: string; requirements: string; subjectUserId: string
  subject: { username: string; displayName: string | null }; partyA: PartyFields; partyB: PartyFields
  quotationFen: string | null; agreementFen: string | null; totalFen: string | null; stage: CommissionStage; progress: number
  progressNote: string; revision: number; expectedDeliveryAt: string | null; startedAt: string | null; acceptedAt: string | null
  adjustmentDays: number; maintenanceDays: number; adjustmentUntil: string | null; maintenanceUntil: string | null
  aftercare: { adjustmentRounds: number | null; adjustmentWorkload: string; supportChannel: string }
  settlement: Record<string, unknown>; createdAt: string; updatedAt: string
  documents: CommissionDocumentDto[]; plans: CommissionPlanDto[]; payments: CommissionPaymentDto[]; changes: CommissionChangeDto[]
  issues: CommissionIssueDto[]; deliveries: CommissionDeliveryDto[]; acceptances: CommissionAcceptanceDto[]; files: CommissionFileDto[]
  milestones: Array<{ id: string; title: string; description: string; dueAt: string | null; completedAt: string | null }>
  events: Array<{ id: string; type: string; note: string; data: Record<string, unknown>; createdAt: string; actor: string }>
  todos: Array<{ key: string; audience: 'ADMIN' | 'USER' | 'BOTH'; text: string; dueAt?: string | null }>
  warnings: string[]; paymentSummary: string
}
