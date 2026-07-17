/**
 * @file solana-session.ts
 * @project SlothVault
 * @module Solana Session Security
 * @description Preserves legacy encrypted tree-authority keys and replaces process-local prepare sessions with short-lived encrypted HMAC tokens.
 * @logic Derive purpose-separated keys from ENCRYPTION_KEY, seal validated transaction context for five minutes, authenticate before decrypting, and reject expired or wrong-purpose tokens.
 * @dependencies node:crypto, zod, server/http/errors
 * @index_tags solana,session,token,hmac,aes-gcm,encryption
 * @author holic512
 */
import 'server-only'

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'

import { z } from 'zod'

import { HttpError } from '@/server/http/errors'

const PRIVATE_KEY_ALGORITHM = 'aes-256-gcm'
const PRIVATE_KEY_IV_BYTES = 16
const PRIVATE_KEY_SALT_BYTES = 32
const SESSION_VERSION = 'v1'
const SESSION_IV_BYTES = 12
const SESSION_TTL_MS = 5 * 60 * 1000
const SESSION_TOKEN_MAX_LENGTH = 16_384

const solanaNetworkSchema = z.enum(['mainnet', 'devnet'])
const decimalIdSchema = z.string().regex(/^[1-9]\d*$/)
const publicKeySchema = z.string().min(32).max(64)
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)

const transactionContextSchema = z.object({
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  nonce: z.string().uuid(),
  network: solanaNetworkSchema,
  payerAddress: publicKeySchema,
  treeAddress: publicKeySchema,
  messageHash: hashSchema,
  recentBlockhash: z.string().min(32).max(100),
  lastValidBlockHeight: z.number().int().nonnegative(),
  programIds: z.array(publicKeySchema).min(1).max(4),
})

const treeSessionSchema = transactionContextSchema.extend({
  kind: z.literal('tree'),
  name: z.string().min(1).max(128),
  treeAuthority: publicKeySchema,
  encryptedKey: z.string().min(1).max(8_192),
  maxDepth: z.number().int().min(1).max(30),
  maxBufferSize: z.number().int().positive(),
  canopyDepth: z.number().int().nonnegative(),
  rentLamports: z.number().int().nonnegative(),
  spaceBytes: z.number().int().positive(),
})

const mintSessionSchema = transactionContextSchema.extend({
  kind: z.literal('mint'),
  merkleTreeId: decimalIdSchema,
  cnftId: decimalIdSchema,
  leafIndex: z.number().int().nonnegative(),
  ownerAddress: publicKeySchema,
  treeAuthority: publicKeySchema,
})

const sessionSchema = z.discriminatedUnion('kind', [treeSessionSchema, mintSessionSchema])

export type TreePrepareSession = z.infer<typeof treeSessionSchema>
export type MintPrepareSession = z.infer<typeof mintSessionSchema>
export type SolanaPrepareSession = z.infer<typeof sessionSchema>
export type TreePrepareSessionInput = Omit<TreePrepareSession, 'issuedAt' | 'expiresAt' | 'nonce'>
export type MintPrepareSessionInput = Omit<MintPrepareSession, 'issuedAt' | 'expiresAt' | 'nonce'>

function encryptionSecret() {
  const secret = process.env.ENCRYPTION_KEY?.trim()
  if (!secret) throw new HttpError('ENCRYPTION_KEY is not configured', 500, 500)
  return secret
}

function deriveKey(purpose: string) {
  return scryptSync(encryptionSecret(), purpose, 32)
}

function validHex(value: string, bytes?: number) {
  return /^[a-f0-9]+$/i.test(value) && value.length % 2 === 0 && (!bytes || value.length === bytes * 2)
}

/**
 * Uses the original Nuxt ciphertext format so existing MerkleTree.encryptedKey
 * records remain readable after migration. The stored salt was historically
 * informational; the derivation salt must stay `solana-tree-key` for compatibility.
 */
export function encryptTreeAuthorityKey(privateKey: string) {
  const key = deriveKey('solana-tree-key')
  const salt = randomBytes(PRIVATE_KEY_SALT_BYTES)
  const iv = randomBytes(PRIVATE_KEY_IV_BYTES)
  const cipher = createCipheriv(PRIVATE_KEY_ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()])
  return [
    salt.toString('hex'),
    iv.toString('hex'),
    cipher.getAuthTag().toString('hex'),
    encrypted.toString('hex'),
  ].join(':')
}

export function decryptTreeAuthorityKey(encryptedData: string) {
  const parts = encryptedData.split(':')
  if (
    parts.length !== 4 ||
    !validHex(parts[0], PRIVATE_KEY_SALT_BYTES) ||
    !validHex(parts[1], PRIVATE_KEY_IV_BYTES) ||
    !validHex(parts[2], 16) ||
    !validHex(parts[3])
  ) {
    throw new HttpError('Invalid encrypted tree authority key', 500, 500)
  }

  try {
    const decipher = createDecipheriv(
      PRIVATE_KEY_ALGORITHM,
      deriveKey('solana-tree-key'),
      Buffer.from(parts[1], 'hex'),
    )
    decipher.setAuthTag(Buffer.from(parts[2], 'hex'))
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], 'hex')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new HttpError('Unable to decrypt tree authority key', 500, 500)
  }
}

export function secretKeyToBase64(secretKey: Uint8Array) {
  return Buffer.from(secretKey).toString('base64')
}

export function secretKeyFromBase64(value: string) {
  let decoded: Buffer
  try {
    decoded = Buffer.from(value, 'base64')
  } catch {
    throw new HttpError('Invalid tree authority key', 500, 500)
  }
  if (decoded.length !== 64) throw new HttpError('Invalid tree authority key', 500, 500)
  return new Uint8Array(decoded)
}

function sessionEncryptionKey() {
  return deriveKey('solana-session-encryption-v1')
}

function sessionHmacKey() {
  return deriveKey('solana-session-hmac-v1')
}

function sessionSignature(input: string) {
  return createHmac('sha256', sessionHmacKey()).update(input).digest()
}

export function sealSolanaSession(input: TreePrepareSessionInput | MintPrepareSessionInput) {
  const issuedAt = Date.now()
  const expiresAt = issuedAt + SESSION_TTL_MS
  const payload = sessionSchema.parse({
    ...input,
    issuedAt,
    expiresAt,
    nonce: randomUUID(),
  })
  const iv = randomBytes(SESSION_IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', sessionEncryptionKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ])
  const unsignedToken = [
    SESSION_VERSION,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.')
  const token = `${unsignedToken}.${sessionSignature(unsignedToken).toString('base64url')}`
  return { token, expiresAt }
}

export function openSolanaSession<Kind extends SolanaPrepareSession['kind']>(
  token: string,
  expectedKind: Kind,
): Extract<SolanaPrepareSession, { kind: Kind }> {
  if (!token || token.length > SESSION_TOKEN_MAX_LENGTH) {
    throw new HttpError('Solana prepare session is invalid or expired', 400, 400)
  }

  const parts = token.split('.')
  if (parts.length !== 5 || parts[0] !== SESSION_VERSION) {
    throw new HttpError('Solana prepare session is invalid or expired', 400, 400)
  }

  const unsignedToken = parts.slice(0, 4).join('.')
  let providedSignature: Buffer
  try {
    providedSignature = Buffer.from(parts[4], 'base64url')
  } catch {
    throw new HttpError('Solana prepare session is invalid or expired', 400, 400)
  }
  const expectedSignature = sessionSignature(unsignedToken)
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new HttpError('Solana prepare session is invalid or expired', 400, 400)
  }

  let parsed: SolanaPrepareSession
  try {
    const iv = Buffer.from(parts[1], 'base64url')
    const ciphertext = Buffer.from(parts[2], 'base64url')
    const authTag = Buffer.from(parts[3], 'base64url')
    if (iv.length !== SESSION_IV_BYTES || authTag.length !== 16 || ciphertext.length === 0) {
      throw new Error('Invalid encrypted token')
    }
    const decipher = createDecipheriv('aes-256-gcm', sessionEncryptionKey(), iv)
    decipher.setAuthTag(authTag)
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8')
    parsed = sessionSchema.parse(JSON.parse(plaintext))
  } catch {
    throw new HttpError('Solana prepare session is invalid or expired', 400, 400)
  }

  if (
    parsed.kind !== expectedKind ||
    parsed.expiresAt <= Date.now() ||
    parsed.issuedAt > Date.now() + 30_000
  ) {
    throw new HttpError('Solana prepare session is invalid or expired', 400, 400)
  }

  return parsed as Extract<SolanaPrepareSession, { kind: Kind }>
}
