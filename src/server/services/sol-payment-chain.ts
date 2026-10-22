/**
 * @file sol-payment-chain.ts
 * @project SlothVault
 * @module Solana Payment Boundary
 * @description Builds and verifies fixed Mainnet native SOL or USDT payments without holding private keys.
 * @logic Preserve native messages; bind USDT to canonical ATAs, the classic token program and six decimals, distinguish token/gas shortages, and require finalized exact-message token balance changes.
 * @dependencies Solana web3/SPL Token, node crypto, zod, bs58, system RPC profiles
 * @index_tags payments,solana,usdt,ata,finality,verification
 * @author holic512
 */
import 'server-only'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, type AccountInfo, type TokenBalance } from '@solana/web3.js'
import { ACCOUNT_SIZE, MINT_SIZE, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, unpackAccount, unpackMint } from '@solana/spl-token'
import bs58 from 'bs58'
import { z } from 'zod'
import type { PreparedSolTransfer, SolTransferIntent, SolTransferObservation } from '@slothvault/plugin-sdk/protocol'
import { getSolanaNetworkProfile } from './system-config'
import { HttpError } from '@/server/http/errors'

const memoProgram = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
export const USDT_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')
export const USDT_DECIMALS = 6
const MAX_TOKEN_AMOUNT = 18_446_744_073_709_551_615n
const baseIntent = { orderId: z.string().uuid(), payer: z.string().max(44), recipient: z.string().max(44), network: z.literal('mainnet') }
const nativeIntentSchema = z.object({ ...baseIntent, asset: z.literal('SOL').optional(), lamports: z.string().regex(/^[1-9]\d{0,15}$/) }).strict()
const tokenIntentSchema = z.object({ ...baseIntent, asset: z.literal('USDT'), tokenAmount: z.string().regex(/^[1-9]\d{0,19}$/) }).strict()
const intentSchema = z.union([nativeIntentSchema, tokenIntentSchema])
const preparedFields = { transactionBase64: z.string().max(1700), messageHash: z.string().regex(/^[a-f0-9]{64}$/), blockhash: z.string().max(44), lastValidBlockHeight: z.number().int().positive() }
const preparedSchema = z.union([nativeIntentSchema.extend(preparedFields), tokenIntentSchema.extend(preparedFields)])
function invalid(): never { throw new HttpError('PAYMENT_TRANSACTION_INVALID', 400) }
function invalidTokenAccount(): never { throw new HttpError('PAYMENT_TOKEN_ACCOUNT_INVALID', 409) }
export function validateSolIntent(value: unknown): SolTransferIntent {
  const input = intentSchema.parse(value)
  try {
    const payer = new PublicKey(input.payer), recipient = new PublicKey(input.recipient)
    if (payer.toBase58() !== input.payer || recipient.toBase58() !== input.recipient || payer.equals(recipient)) invalid()
    if (input.asset === 'USDT') {
      if (BigInt(input.tokenAmount) > MAX_TOKEN_AMOUNT || !PublicKey.isOnCurve(payer.toBytes())) invalid()
    } else if (BigInt(input.lamports) > BigInt(Number.MAX_SAFE_INTEGER)) invalid()
  } catch { invalid() }
  return input
}
const hash = (tx: Transaction) => createHash('sha256').update(tx.serializeMessage()).digest('hex')
const tokenAddresses = (intent: SolTransferIntent) => ({
  source: getAssociatedTokenAddressSync(USDT_MINT, new PublicKey(intent.payer), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
  destination: getAssociatedTokenAddressSync(USDT_MINT, new PublicKey(intent.recipient), true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
})
export function buildSolTransfer(pluginId: string, input: SolTransferIntent, blockhash: string, lastValidBlockHeight: number) {
  const intent = validateSolIntent(input), payer = new PublicKey(intent.payer), recipient = new PublicKey(intent.recipient)
  const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight })
  if (intent.asset === 'USDT') {
    const { source, destination } = tokenAddresses(intent)
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(payer, destination, recipient, USDT_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
      createTransferCheckedInstruction(source, USDT_MINT, destination, payer, BigInt(intent.tokenAmount), USDT_DECIMALS, [], TOKEN_PROGRAM_ID),
    )
  } else tx.add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: recipient, lamports: BigInt(intent.lamports) }))
  return tx.add(new TransactionInstruction({ programId: memoProgram, keys: [{ pubkey: payer, isSigner: true, isWritable: false }], data: Buffer.from(`${pluginId}:${intent.orderId}`) }))
}
export function validatePreparedTransfer(pluginId: string, value: unknown) {
  const prepared = preparedSchema.parse(value)
  const { transactionBase64, messageHash, blockhash, lastValidBlockHeight, ...intent } = prepared
  const expected = buildSolTransfer(pluginId, intent, blockhash, lastValidBlockHeight)
  if (hash(expected) !== messageHash || expected.serialize({ requireAllSignatures: false }).toString('base64') !== transactionBase64) invalid()
  return prepared
}
export function validateSignedTransfer(pluginId: string, value: unknown) {
  const input = z.object({ prepared: preparedSchema, signedTransaction: z.string().max(1700) }).strict().parse(value)
  const prepared = validatePreparedTransfer(pluginId, input.prepared)
  let tx: Transaction
  try { const bytes = Buffer.from(input.signedTransaction, 'base64'); if (bytes.length > 1232) invalid(); tx = Transaction.from(bytes) } catch { invalid() }
  if (hash(tx) !== prepared.messageHash || !tx.verifySignatures(true) || !tx.signature) invalid()
  return { signature: bs58.encode(tx.signature), transaction: tx, prepared }
}
async function withPaymentRpc<T>(operation: (connection: Connection) => Promise<T>): Promise<T> {
  const profile = await getSolanaNetworkProfile('mainnet')
  for (const url of [...new Set([profile.primaryUrl, profile.fallbackUrl].filter(Boolean))]) {
    const signal = AbortSignal.timeout(2200)
    const connection = new Connection(url, { commitment: 'finalized', disableRetryOnRateLimit: true, fetch: (input, init) => fetch(input, { ...init, signal }) })
    try { if (await connection.getGenesisHash() !== MAINNET_GENESIS) continue; return await operation(connection) } catch (error) { if (error instanceof HttpError) throw error; /* Retry only the same immutable intent/signature at the other node. */ }
  }
  throw new HttpError('PAYMENT_RPC_UNAVAILABLE', 503)
}
function readTokenAccount(address: PublicKey, info: AccountInfo<Buffer> | null, owner: string) {
  try {
    if (!info || info.data.length !== ACCOUNT_SIZE) invalidTokenAccount()
    const account = unpackAccount(address, info, TOKEN_PROGRAM_ID)
    if (!account.mint.equals(USDT_MINT) || account.owner.toBase58() !== owner || !account.isInitialized || account.isFrozen || account.isNative) invalidTokenAccount()
    return account
  } catch { invalidTokenAccount() }
}
async function tokenRentAndBalance(connection: Connection, intent: Extract<SolTransferIntent, { asset: 'USDT' }>) {
  const { source, destination } = tokenAddresses(intent)
  const [mintInfo, sourceInfo, destinationInfo] = await connection.getMultipleAccountsInfo([USDT_MINT, source, destination], 'confirmed')
  try {
    if (!mintInfo || mintInfo.data.length !== MINT_SIZE) invalidTokenAccount()
    const mint = unpackMint(USDT_MINT, mintInfo, TOKEN_PROGRAM_ID)
    if (!mint.isInitialized || mint.decimals !== USDT_DECIMALS) invalidTokenAccount()
  } catch { invalidTokenAccount() }
  if (!sourceInfo) throw new HttpError('PAYMENT_TOKEN_BALANCE_INSUFFICIENT', 409)
  const sourceAccount = readTokenAccount(source, sourceInfo, intent.payer)
  if (sourceAccount.amount < BigInt(intent.tokenAmount)) throw new HttpError('PAYMENT_TOKEN_BALANCE_INSUFFICIENT', 409)
  if (destinationInfo) { readTokenAccount(destination, destinationInfo, intent.recipient); return 0 }
  return connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE, 'confirmed')
}
export async function prepareSolTransfer(pluginId: string, input: unknown): Promise<PreparedSolTransfer> {
  const intent = validateSolIntent(input)
  return withPaymentRpc(async connection => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized')
    const tx = buildSolTransfer(pluginId, intent, blockhash, lastValidBlockHeight)
    const rent = intent.asset === 'USDT' ? await tokenRentAndBalance(connection, intent) : 0
    const [balance, fee] = await Promise.all([connection.getBalance(new PublicKey(intent.payer), 'confirmed'), connection.getFeeForMessage(tx.compileMessage(), 'confirmed')])
    if (fee.value === null) throw new Error('Unable to estimate payment fee')
    if (intent.asset === 'USDT') {
      if (BigInt(balance) < BigInt(fee.value) + BigInt(rent)) throw new HttpError('PAYMENT_GAS_INSUFFICIENT', 409)
    } else if (BigInt(balance) < BigInt(intent.lamports) + BigInt(fee.value)) throw new HttpError('PAYMENT_BALANCE_INSUFFICIENT', 409)
    return { ...intent, blockhash, lastValidBlockHeight, messageHash: hash(tx), transactionBase64: tx.serialize({ requireAllSignatures: false }).toString('base64') }
  })
}
export async function broadcastSolTransfer(pluginId: string, input: unknown) {
  const checked = validateSignedTransfer(pluginId, input)
  const result = await withPaymentRpc(c => c.sendRawTransaction(checked.transaction.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 }))
  if (result !== checked.signature) invalid()
  return { signature: result }
}
function tokenBalance(balances: TokenBalance[] | null | undefined, accountIndex: number, owner: string, required: boolean) {
  if (!balances) invalid()
  const entries = balances.filter(balance => balance.accountIndex === accountIndex)
  if (!entries.length && !required) return 0n
  if (entries.length !== 1) invalid()
  const entry = entries[0]
  if (entry.mint !== USDT_MINT.toBase58() || entry.owner !== owner || entry.programId !== TOKEN_PROGRAM_ID.toBase58()
    || entry.uiTokenAmount.decimals !== USDT_DECIMALS || !/^(0|[1-9]\d{0,19})$/.test(entry.uiTokenAmount.amount)) invalid()
  const amount = BigInt(entry.uiTokenAmount.amount)
  if (amount > MAX_TOKEN_AMOUNT) invalid()
  return amount
}
export async function observeSolTransfer(pluginId: string, value: unknown): Promise<SolTransferObservation> {
  const input = z.object({ prepared: preparedSchema, signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/).optional() }).strict().parse(value)
  const prepared = validatePreparedTransfer(pluginId, input.prepared)
  return withPaymentRpc(async connection => {
    if (!input.signature) return { status: await connection.getBlockHeight('finalized') > prepared.lastValidBlockHeight ? 'EXPIRED' : 'PENDING' }
    const result = await connection.getTransaction(input.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 })
    if (!result) return { status: 'PENDING' } // A null RPC result is never proof of a failed payment.
    if (result.version !== 'legacy' || !result.meta || !('accountKeys' in result.transaction.message)) invalid()
    const tx = Transaction.populate(result.transaction.message, result.transaction.signatures)
    if (hash(tx) !== prepared.messageHash || !tx.verifySignatures(true) || !tx.signature || bs58.encode(tx.signature) !== input.signature) invalid()
    if (prepared.asset === 'USDT') {
      const statuses = await connection.getSignatureStatuses([input.signature], { searchTransactionHistory: true })
      const status = statuses.value[0]
      if (!status || status.confirmationStatus !== 'finalized') return { status: 'PENDING' }
      if (status.slot !== result.slot) invalid()
      if (!isDeepStrictEqual(status.err, result.meta.err)) invalid()
      if (!result.meta.err) {
        const { source, destination } = tokenAddresses(prepared)
        const keys = result.transaction.message.accountKeys
        const sourceIndex = keys.findIndex(key => key.equals(source)), destinationIndex = keys.findIndex(key => key.equals(destination))
        if (sourceIndex < 0 || destinationIndex < 0) invalid()
        const beforeSource = tokenBalance(result.meta.preTokenBalances, sourceIndex, prepared.payer, true)
        const afterSource = tokenBalance(result.meta.postTokenBalances, sourceIndex, prepared.payer, true)
        const beforeRecipient = tokenBalance(result.meta.preTokenBalances, destinationIndex, prepared.recipient, false)
        const afterRecipient = tokenBalance(result.meta.postTokenBalances, destinationIndex, prepared.recipient, true)
        if (beforeSource - afterSource !== BigInt(prepared.tokenAmount) || afterRecipient - beforeRecipient !== BigInt(prepared.tokenAmount)) invalid()
      }
    }
    return { status: result.meta.err ? 'FAILED' : 'FINALIZED', slot: result.slot }
  })
}
