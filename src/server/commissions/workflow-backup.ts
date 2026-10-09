/**
 * @file workflow-backup.ts
 * @project SlothVault
 * @module Workflow Backup Contract
 * @description Defines portable workflow collections while preserving canonical snapshots byte for byte.
 * @logic Remap relational IDs outside snapshots and verify each commission chain before restore.
 * @dependencies zod, immutable submission verifier
 * @index_tags commissions,backup,restore,evidence
 * @author holic512
 */
import 'server-only'
import { z } from 'zod'
import { canonicalJson, verifySubmissionChain } from './submissions'
import { Transaction } from '@solana/web3.js'
import { assertSignedMemoTransaction, memoTransactionMessageHash } from '@/server/services/solana-memo-transaction'
import { renderSimpleTemplate, type SimpleTemplateVersion, type SubmissionSnapshot } from '@/lib/commission-workflow'
const id = z.string().regex(/^[1-9]\d*$/).refine((value) => BigInt(value) <= 2147483647n)
const date = z.iso.datetime({ offset: true })
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const json = z.string().max(1000000)
const rows = <T extends z.ZodType>(schema: T) => z.array(schema).max(100000).default([])
export const workflowBackupShape = {
  commissionInvitations: rows(z.object({ id, commissionId: id, tokenHash: hash, expiresAt: date, revokedAt: date.nullable(), claimedAt: date.nullable(), claimedById: id.nullable(), createdAt: date }).strict()),
  commissionAgreements: rows(z.object({ id, publicId: z.string().uuid(), commissionId: id, kind: z.enum(['AGREEMENT', 'SUPPLEMENT']), status: z.enum(['DRAFT', 'PENDING', 'CONFIRMED', 'DECLINED', 'SUPERSEDED']), title: z.string().max(255), body: z.string().max(200000), templateJson: json, valuesJson: json, fileKeysJson: json, totalFen: z.string().regex(/^\d{1,14}$/).nullable(), maintenanceDays: z.number().int().min(1).max(3650), confirmationMode: z.enum(['ONLINE', 'OFFLINE']), publishedEventId: z.string().uuid().nullable(), confirmedAt: date.nullable(), createdAt: date }).strict()),
  commissionSubmissions: rows(z.object({ id, publicId: z.string().uuid(), commissionId: id, sequence: z.number().int().positive(), commandId: z.string().max(255), requestHash: hash, actorUserId: id.nullable(), type: z.string().max(255), snapshotJson: json, snapshotHash: hash, previousHash: hash.nullable(), proofRevision: z.number().int().nonnegative(), createdAt: date }).strict()),
  commissionProofAttempts: rows(z.object({ id, submissionId: id, network: z.enum(['devnet', 'mainnet']), issuerUserId: id, signerAddress: z.string().max(64), status: z.enum(['PREPARED', 'SUBMITTED', 'FINALIZED', 'FAILED', 'CANCELLED']), memo: z.string().max(1000), messageHash: hash, transactionBase64: z.string().max(2000), lastValidBlockHeight: z.string().regex(/^\d+$/), expiresAt: date, transactionSignature: z.string().max(100).nullable(), slot: z.string().regex(/^\d+$/).nullable(), blockTime: date.nullable(), feeLamports: z.string().regex(/^\d+$/).nullable(), error: z.string().max(10000).nullable(), createdAt: date, finalizedAt: date.nullable() }).strict()),
}
export const workflowCollectionSpecs = [
  { key: 'commissionInvitations', delegate: 'commissionInvitation', refs: { commissionId: 'commissions', claimedById: 'users' }, dates: ['expiresAt', 'revokedAt', 'claimedAt', 'createdAt'], money: [] },
  { key: 'commissionAgreements', delegate: 'commissionAgreement', refs: { commissionId: 'commissions' }, dates: ['confirmedAt', 'createdAt'], money: ['totalFen'] },
  { key: 'commissionSubmissions', delegate: 'commissionSubmission', refs: { commissionId: 'commissions', actorUserId: 'users' }, dates: ['createdAt'], money: [] },
  { key: 'commissionProofAttempts', delegate: 'commissionProofAttempt', refs: { submissionId: 'commissionSubmissions', issuerUserId: 'users' }, dates: ['expiresAt', 'blockTime', 'createdAt', 'finalizedAt'], money: ['lastValidBlockHeight', 'slot', 'feeLamports'] },
] as const
export function validateWorkflowBackup(data: Record<string, unknown>) {
  const parsed = z.object(workflowBackupShape).parse(data)
  const commissions = (data.commissions || []) as Array<{ id: string; commissionId: string }>
  const files = (data.commissionFiles || []) as Array<{ id: string; commissionId: string; fileId: string; sha256: string; purpose: string; shared: boolean }>
  const metadata = (data.fileManagements || []) as Array<{ id: string; fileName: string; originalName: string; fileSize: string }>
  for (const proof of parsed.commissionProofAttempts) {
    const event = parsed.commissionSubmissions.find((item) => item.id === proof.submissionId)
    const commission = commissions.find((item) => item.id === event?.commissionId)
    if (!event || !commission) throw new Error('Evidence snapshot is missing')
    const expected = canonicalJson({ protocol: 'slothvault.commission', version: 1, commissionId: commission.commissionId, eventId: event.publicId, snapshotHash: event.snapshotHash, previousHash: event.previousHash, network: proof.network })
    const transaction = Transaction.from(Buffer.from(proof.transactionBase64, 'base64'))
    if (proof.memo !== expected || memoTransactionMessageHash(transaction) !== proof.messageHash) throw new Error('Evidence transaction differs from its frozen snapshot')
    if (proof.transactionSignature) {
      const signature = assertSignedMemoTransaction({ transaction, memo: expected, signerAddress: proof.signerAddress, messageHash: proof.messageHash })
      if (signature !== proof.transactionSignature) throw new Error('Evidence signature differs from signed bytes')
    }
    if (['SUBMITTED', 'FINALIZED'].includes(proof.status) && !proof.transactionSignature) throw new Error('Signed evidence has no signature')
    if (proof.status === 'FINALIZED' && (!proof.finalizedAt || proof.slot === null)) throw new Error('Finalized evidence has no receipt')
  }
  for (const commission of commissions) {
    const events = parsed.commissionSubmissions.filter((event) => event.commissionId === commission.id).sort((a, b) => a.sequence - b.sequence)
    verifySubmissionChain(events.map((event) => ({ ...event, createdAt: new Date(event.createdAt) })), commission.commissionId)
    const priorIds = new Set<string>()
    for (const event of events) {
      const snapshot = JSON.parse(event.snapshotJson) as SubmissionSnapshot
      if (snapshot.reference && !priorIds.has(snapshot.reference)) throw new Error('Snapshot reference crosses commission or points forward')
      priorIds.add(snapshot.eventId)
      for (const attachment of snapshot.attachments) {
        const stored = metadata.find((file) => file.fileName === attachment.key)
        const owned = stored && files.find((file) => file.fileId === stored.id && file.commissionId === commission.id)
        if (!owned?.shared || owned.sha256 !== attachment.sha256 || stored?.fileSize !== attachment.size || stored?.originalName !== attachment.name || owned.purpose !== attachment.purpose) throw new Error('Frozen submission attachment differs from stored file')
      }
    }
    for (const agreement of parsed.commissionAgreements.filter((item) => item.commissionId === commission.id)) {
      const template = JSON.parse(agreement.templateJson) as SimpleTemplateVersion
      if (renderSimpleTemplate(template.body, template.fields, JSON.parse(agreement.valuesJson), agreement.status !== 'DRAFT') !== agreement.body) throw new Error('Agreement template does not match body')
      if (agreement.publishedEventId) {
        const event = events.find((item) => item.publicId === agreement.publishedEventId)
        const publication = event ? JSON.parse(event.snapshotJson) as SubmissionSnapshot : null
        const actual = { publicId: agreement.publicId, title: agreement.title, kind: agreement.kind, body: agreement.body, template, values: JSON.parse(agreement.valuesJson), totalFen: agreement.totalFen, maintenanceDays: agreement.maintenanceDays, confirmationMode: agreement.confirmationMode }
        if (!publication || canonicalJson(publication.data.agreement) !== canonicalJson(actual) || canonicalJson(publication.attachments.map((file) => file.key)) !== canonicalJson(JSON.parse(agreement.fileKeysJson))) throw new Error('Agreement publication snapshot is missing or invalid')
      }
    }
  }
}
