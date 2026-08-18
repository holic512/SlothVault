/**
 * @file contract-evidence-protocol.ts
 * @project SlothVault
 * @module Contract Evidence Protocol
 * @description Defines canonical Web2 contract hashing and the privacy-preserving Solana Memo payload for one frozen contract snapshot.
 * @logic Normalize the authoritative Markdown once, hash binary PDF bytes unchanged, bind a non-identifying party commitment into the root hash, and emit a fixed-order public Memo without contract content or identities.
 * @dependencies node:crypto, system-config network type
 * @index_tags contracts,evidence,solana,memo,sha256,privacy,protocol
 * @author holic512
 */
import 'server-only'

import { createHash } from 'node:crypto'

import type { SolanaNetwork } from '@/server/services/system-config'

export const CONTRACT_EVIDENCE_PROTOCOL = 'slothvault.contract'
export const CONTRACT_EVIDENCE_PROTOCOL_VERSION = 1

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

export function normalizeContractBody(value: string) {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trimEnd() + '\n'
}

export function contractBodyHash(value: string) {
  return sha256(normalizeContractBody(value))
}

export function contractAttachmentHash(value: Buffer) {
  return sha256(value)
}

export function contractTitleHash(value: string) {
  return sha256(value.trim())
}

export function partyCommitment(input: {
  contractId: string
  subjectUserId: number
  nonce: string
}) {
  return sha256(JSON.stringify({
    contractId: input.contractId,
    subjectUserId: input.subjectUserId,
    nonce: input.nonce,
  }))
}

export function canonicalContractSnapshot(input: {
  installationId: string
  contractId: string
  title: string
  bodyHash: string
  attachmentHash: string | null
  partyCommitment: string
  issuedAt: Date
  signedAt: Date
}) {
  return JSON.stringify({
    protocol: CONTRACT_EVIDENCE_PROTOCOL,
    version: CONTRACT_EVIDENCE_PROTOCOL_VERSION,
    installationId: input.installationId,
    contractId: input.contractId,
    titleHash: contractTitleHash(input.title),
    bodyHash: input.bodyHash,
    attachmentHash: input.attachmentHash,
    partyCommitment: input.partyCommitment,
    issuedAt: input.issuedAt.toISOString(),
    signedAt: input.signedAt.toISOString(),
  })
}

export function contractRootHash(input: Parameters<typeof canonicalContractSnapshot>[0]) {
  return sha256(canonicalContractSnapshot(input))
}

export function canonicalContractEvidenceMemo(input: {
  installationId: string
  contractId: string
  contractHash: string
  bodyHash: string
  attachmentHash: string | null
  network: SolanaNetwork
  signer: string
}) {
  return JSON.stringify({
    protocol: CONTRACT_EVIDENCE_PROTOCOL,
    version: CONTRACT_EVIDENCE_PROTOCOL_VERSION,
    installationId: input.installationId,
    contractId: input.contractId,
    contractHash: input.contractHash,
    bodyHash: input.bodyHash,
    attachmentHash: input.attachmentHash,
    network: input.network,
    signer: input.signer,
  })
}
