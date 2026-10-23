/**
 * @file domain.ts
 * @project SlothVault
 * @module Commissions public contract
 * @description Shared, browser-safe DTOs and the sole commissions API contract.
 * @logic Commands carry commandId and revision; frozen actions take effect only after mainnet FINALIZED evidence.
 * @dependencies None
 * @index_tags commissions,dto,api,state-machine
 * @author holic512
 */
export const PLUGIN_ID = 'slothvault.commissions'
export const STAGES = ['DRAFT', 'REQUESTED', 'CONTRACT_PREPARATION', 'AWAITING_CONFIRMATION', 'READY', 'IN_PROGRESS', 'MAINTENANCE', 'CLOSED', 'TERMINATED'] as const
export type CommissionStage = typeof STAGES[number]
export type EvidenceStatus = 'AWAITING_ADMIN' | 'PREPARED' | 'SUBMITTED' | 'FINALIZED' | 'FAILED' | 'EXPIRED' | 'WITHDRAWN'
export type FrozenKind = 'REQUEST' | 'CONTRACT' | 'CONFIRMATION' | 'DELIVERY'
export type AttachmentPurpose = 'request' | 'contract' | 'delivery' | 'maintenance'
export type TemplateKind = 'MAIN' | 'SUPPLEMENT'
export type FieldValue = string | number | boolean
export interface TemplateField { key: string; label: string; type: 'string' | 'number' | 'boolean'; required: boolean; default?: FieldValue; semantic: string }
export interface ContractTemplate { id: string; family: string; version: number; kind: TemplateKind; title: string; scenario: string; applicableWhen: string; requiredMaterials: string[]; fields: TemplateField[]; body: string; published: boolean; createdAt: string }
export interface PrivateFile { id: string; name: string; size: string; sha256: string; createdAt: string }
export interface Attachment extends PrivateFile { purpose: AttachmentPurpose; uploadedBy: number; shared: boolean }
export interface ContractDraft { templateId: string; kind: TemplateKind; title: string; fields: Record<string, FieldValue>; body: string }
export interface ContractVersion extends ContractDraft { id: string; version: number; publishedAt: string; effectiveAt: string | null; rejectedAt?: string | null; rejectionReason?: string | null; confirmation: { method: 'ONLINE' | 'OFFLINE'; actorId: number; note: string; recordedAt: string } | null }
export interface FrozenAction { id: string; kind: FrozenKind; status: EvidenceStatus; digest: string; memo: string; snapshot: Record<string, unknown>; createdAt: string; effectiveAt: string | null; attemptId: string | null; signature: string | null; error: string | null }
export interface EvidencePrepared { transactionBase64: string; messageHash: string; blockhash: string; lastValidBlockHeight: string; feeLamports: number; balanceLamports: number; signerAddress: string; memo: string }
export interface EvidenceAttempt { id: string; evidenceId: string; status: EvidenceStatus; signature: string | null; prepared: EvidencePrepared; error: string | null; createdAt: string }
export interface AuditEvent { id: string; type: string; actorId: number | null; createdAt: string; payload: Record<string, unknown>; previousHash: string | null; hash: string }
export interface Commission { id: string; revision: number; title: string; description: string; customerId: number | null; createdBy: number; stage: CommissionStage; paused: boolean; paymentPercent: number; maintenanceDays: number; maintenanceStartedAt: string | null; maintenanceEndsAt: string | null; contractDraft: ContractDraft | null; contracts: ContractVersion[]; createdAt: string; updatedAt: string }
export type CommandAction = 'update-draft' | 'submit-request' | 'accept' | 'return-request' | 'save-contract' | 'publish-contract' | 'confirm-contract' | 'record-confirmation' | 'start' | 'deliver' | 'pause' | 'resume' | 'terminate' | 'payment' | 'comment' | 'maintenance-feedback' | 'maintenance-resolve' | 'withdraw' | 'invite' | 'revoke-invitation' | 'decline-contract' | 'close-maintenance'
export interface CommissionDetail { contractDefaults?: { customerName?: string; providerName?: string }; commission: Commission; pendingAction: FrozenAction | null; evidence: FrozenAction[]; attachments: Attachment[]; events: AuditEvent[]; nextActor: 'ADMIN' | 'CUSTOMER' | 'NONE'; allowedActions: CommandAction[]; blockers: string[] }
export interface UserOption { id: number; username: string; displayName: string | null; role: string; status: string | number }
export interface CommandBase { commandId: string; revision: number }
export interface CreateInput extends CommandBase { title: string; description?: string; customerId?: number | null; maintenanceDays?: number; templateId?: string }
export interface CommandInput extends CommandBase { commissionId: string; action: CommandAction; data?: Record<string, unknown> }
export interface PrepareInput extends CommandBase { commissionId: string; evidenceId: string; signerAddress: string }
export interface SubmitInput extends CommandBase { commissionId: string; evidenceId: string; attemptId: string; signedTransactionBase64: string }
export interface ReconcileInput extends CommandBase { commissionId: string; evidenceId: string }
export interface CommandResult { detail: CommissionDetail; invitationToken?: string }
export interface PublicReceipt { evidenceId: string; digest: string; memo: string; status: EvidenceStatus; signature: string | null; network: 'mainnet'; finalizedAt: string | null }
/** URL query carries GET filters and file transport metadata. All JSON POSTs carry commandId + revision.
 * list GET ?scope=admin|mine; detail GET ?commissionId; templates GET ?kind&scenario (never seeds).
 * create POST CreateInput (revision=0); command POST CommandInput -> CommandResult.
 * prepare POST PrepareInput -> {detail,attempt}; submit POST SubmitInput -> CommandResult;
 * reconcile POST ReconcileInput -> CommandResult; evidence GET -> {list:[{commissionId,title,evidence}]} (admin).
 * users GET ?query -> {list:UserOption[]}; template-save POST {commandId,revision,template:ContractTemplate} -> {template};
 * settings GET -> {acceptingNew,revision}; settings POST {commandId,revision,acceptingNew} -> same.
 * invitation GET ?token -> {valid,expiresAt}; claim POST {commandId,revision:0,token} -> CommandResult.
 * receipt GET ?evidenceId -> PublicReceipt (no private snapshot).
 * upload POST raw File body (application/octet-stream), X-File-Name=encodeURIComponent(name), X-File-Size=size;
 * query commissionId,purpose,commandId,revision; host two-phase authorize/complete transport.
 * download GET ?commissionId&fileId -> host stream; archive GET ?commissionId -> host ZIP stream.
 * invite action data {expiresInDays?:number} -> CommandResult with one-time token (hash persisted; idempotent replay omits token).
 * command data: draft {title?,description?,customerId?,maintenanceDays?}; save-contract {draft:ContractDraft};
 * confirm/record {contractId,note?}; deliver {description,fileIds:string[]}; withdraw {evidenceId};
 * submit-request/publish-contract {fileIds:string[]}; decline-contract {contractId,reason};
 * close-maintenance {reason}; revoke-invitation {}; invite revokes previous unclaimed invitations.
 * return/terminate {reason}; payment {percent,reason}; comment/maintenance-* {text}; others {}.
 * UI entries: admin.tsx/admin, templates-page.tsx/templates, evidence-page.tsx/evidence,
 * account-page.tsx/account, invitation-page.tsx/invitation, receipt-page.tsx/receipt.
 * All entry modules default-export their page. Detail selected by URL ?commissionId; public ?token / ?evidenceId.
 */
export const API = { list: 'list', detail: 'detail', create: 'create', command: 'command', templates: 'templates', templateSave: 'template-save', evidence: 'evidence', prepare: 'prepare', submit: 'submit', reconcile: 'reconcile', users: 'users', settings: 'settings', invitation: 'invitation', claim: 'claim', receipt: 'receipt', upload: 'upload', download: 'download', archive: 'archive' } as const
