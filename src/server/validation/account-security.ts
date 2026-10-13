/**
 * @file account-security.ts
 * @project SlothVault
 * @module Account Security Validation
 * @description Validates operation-specific wallet challenges and personal credential mutations.
 * @logic Require explicit purposes, bound targets and discriminated reauthentication proofs before invoking services.
 * @dependencies zod
 * @index_tags account,wallet,validation,credentials
 * @author holic512
 */
import { z } from 'zod'

export const usernameSchema = z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_]+$/).transform(value => value.toLowerCase())
export const walletIdSchema = z.string().regex(/^[1-9]\d*$/).refine(value => Number.isSafeInteger(Number(value)) && Number(value) <= 2_147_483_647)
const addressSchema = z.string().trim().min(32).max(64)
export const walletProofSchema = z.object({ challengeId: z.string().uuid(), address: addressSchema, signature: z.string().trim().min(64).max(256) })
export const accountActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('bind'), address: addressSchema }).strict(),
  z.object({ action: z.literal('replace'), walletId: walletIdSchema, address: addressSchema }).strict(),
  z.object({ action: z.literal('unbind'), walletId: walletIdSchema }).strict(),
  z.object({ action: z.literal('credentials'), username: usernameSchema.optional(), passwordChange: z.boolean() }).strict(),
])
export const reauthenticationSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('password'), password: z.string().min(1).max(256) }).strict(),
  walletProofSchema.extend({ method: z.literal('wallet') }).strict(),
])
export const walletChallengeSchema = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('login'), address: addressSchema }).strict(),
  z.object({ purpose: z.literal('bind'), address: addressSchema, target: accountActionSchema }).strict(),
  z.object({ purpose: z.literal('replace'), address: addressSchema, target: accountActionSchema }).strict(),
  z.object({ purpose: z.literal('reauth'), address: addressSchema, target: accountActionSchema }).strict(),
])
export const walletMutationSchema = walletProofSchema.extend({ reauth: reauthenticationSchema }).strict()
export const credentialsSchema = z.object({ username: usernameSchema.optional(), newPassword: z.string().min(8).max(256).optional(), reauth: reauthenticationSchema }).strict().refine(value => value.username !== undefined || value.newPassword !== undefined)
