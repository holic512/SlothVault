/**
 * @file note-content-evidence-protocol.ts
 * @project SlothVault
 * @module Note Content Evidence Protocol
 * @description Defines the deterministic note-content manifest, SHA-256 identity, and wallet-signed Solana Memo contract used by note revision evidence.
 * @logic Serialize only stable release and editorial fields in a fixed order, hash the UTF-8 manifest without database IDs, and require the selected wallet to sign the exact canonical Memo transaction.
 * @dependencies node:crypto, @solana/web3.js, solana-memo-transaction, system-config
 * @index_tags evidence,notes,content,manifest,sha256,solana,memo
 * @author holic512
 */
import 'server-only'

import { createHash } from 'node:crypto'

import { PublicKey, Transaction } from '@solana/web3.js'

import {
  assertSignedMemoTransaction,
  buildMemoTransaction,
  memoTransactionMessageHash,
  parseSignedMemoTransaction,
  serializePreparedMemoTransaction,
} from '@/server/services/solana-memo-transaction'
import type { SolanaNetwork } from '@/server/services/system-config'

export const NOTE_CONTENT_EVIDENCE_PROTOCOL = 'slothvault.note-content'
export const NOTE_CONTENT_EVIDENCE_PROTOCOL_VERSION = 1
export const NOTE_CONTENT_MANIFEST_VERSION = 1
export const PROJECT_VERSION_EVIDENCE_SUBJECT = 'PROJECT_VERSION'
export const NOTE_CONTENT_EVIDENCE_SUBJECT = 'NOTE_CONTENT'

export type EvidenceSubjectType =
  | typeof PROJECT_VERSION_EVIDENCE_SUBJECT
  | typeof NOTE_CONTENT_EVIDENCE_SUBJECT

export type NoteContentEvidenceSource = {
  releaseId: string
  projectVersion: string
  categoryName: string
  noteTitle: string
  versionNote: string | null
  isPrimary: boolean
  status: number
  markdown: string
}

export type NoteContentManifest = {
  schema: typeof NOTE_CONTENT_MANIFEST_VERSION
  releaseId: string
  projectVersion: { label: string }
  category: { name: string }
  note: { title: string }
  content: {
    versionNote: string | null
    isPrimary: boolean
    status: number
    markdown: string
  }
}

export function buildNoteContentManifest(source: NoteContentEvidenceSource) {
  const manifest: NoteContentManifest = {
    schema: NOTE_CONTENT_MANIFEST_VERSION,
    releaseId: source.releaseId,
    projectVersion: { label: source.projectVersion },
    category: { name: source.categoryName },
    note: { title: source.noteTitle },
    content: {
      versionNote: source.versionNote,
      isPrimary: source.isPrimary,
      status: source.status,
      markdown: source.markdown,
    },
  }
  const bytes = Buffer.from(JSON.stringify(manifest), 'utf8')
  return {
    manifest,
    bytes,
    hash: createHash('sha256').update(bytes).digest('hex'),
  }
}

export type NoteContentEvidenceMemo = {
  protocol: typeof NOTE_CONTENT_EVIDENCE_PROTOCOL
  version: typeof NOTE_CONTENT_EVIDENCE_PROTOCOL_VERSION
  installationId: string
  contentEvidenceId: string
  releaseId: string
  manifestVersion: typeof NOTE_CONTENT_MANIFEST_VERSION
  contentHash: string
  network: SolanaNetwork
  signer: string
}

export function canonicalNoteContentEvidenceMemo(
  input: Omit<NoteContentEvidenceMemo, 'protocol' | 'version'>,
) {
  return JSON.stringify({
    protocol: NOTE_CONTENT_EVIDENCE_PROTOCOL,
    version: NOTE_CONTENT_EVIDENCE_PROTOCOL_VERSION,
    installationId: input.installationId,
    contentEvidenceId: input.contentEvidenceId,
    releaseId: input.releaseId,
    manifestVersion: input.manifestVersion,
    contentHash: input.contentHash,
    network: input.network,
    signer: input.signer,
  } satisfies NoteContentEvidenceMemo)
}

export function buildNoteContentEvidenceTransaction(input: {
  memo: string
  signer: PublicKey
  blockhash: string
  lastValidBlockHeight: number
}) {
  return buildMemoTransaction(input)
}

export function noteContentEvidenceMessageHash(transaction: Transaction) {
  return memoTransactionMessageHash(transaction)
}

export function serializePreparedNoteContentEvidence(transaction: Transaction) {
  return serializePreparedMemoTransaction(transaction)
}

export function parseSignedNoteContentEvidence(value: string) {
  return parseSignedMemoTransaction(value)
}

export function assertSignedNoteContentEvidenceTransaction(input: {
  transaction: Transaction
  memo: string
  signerAddress: string
  messageHash: string
}) {
  return assertSignedMemoTransaction(input)
}
