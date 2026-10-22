/**
 * @file sol-payment-chain.ts
 * @project SlothVault
 * @module SOL Transfer Boundary
 * @description Builds and verifies fixed native SOL payments without holding private keys.
 * @logic Bind intent to a plugin-scoped Memo and exact message, verify Mainnet genesis, and only accept successful finalized transactions.
 * @dependencies Solana web3, node crypto, zod, bs58, system RPC profiles
 * @index_tags payments,solana,finality,verification
 * @author holic512
 */
import 'server-only'
import { createHash } from 'node:crypto'
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'
import bs58 from 'bs58'
import { z } from 'zod'
import type { PreparedSolTransfer, SolTransferIntent, SolTransferObservation } from '@slothvault/plugin-sdk/protocol'
import { getSolanaNetworkProfile } from './system-config'
import { HttpError } from '@/server/http/errors'

const memoProgram = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
const intentSchema = z.object({ orderId: z.string().uuid(), payer: z.string().max(44), recipient: z.string().max(44), lamports: z.string().regex(/^[1-9]\d{0,15}$/), network: z.literal('mainnet') }).strict()
const preparedSchema = intentSchema.extend({ transactionBase64: z.string().max(1700), messageHash: z.string().regex(/^[a-f0-9]{64}$/), blockhash: z.string().max(44), lastValidBlockHeight: z.number().int().positive() })
function invalid(): never { throw new HttpError('PAYMENT_TRANSACTION_INVALID', 400) }
export function validateSolIntent(value: unknown): SolTransferIntent {
  const input = intentSchema.parse(value)
  try {
    const payer = new PublicKey(input.payer), recipient = new PublicKey(input.recipient)
    if (payer.toBase58() !== input.payer || recipient.toBase58() !== input.recipient || payer.equals(recipient) || BigInt(input.lamports) > BigInt(Number.MAX_SAFE_INTEGER)) invalid()
  } catch { invalid() }
  return input
}
const hash = (tx: Transaction) => createHash('sha256').update(tx.serializeMessage()).digest('hex')
export function buildSolTransfer(pluginId: string, input: SolTransferIntent, blockhash: string, lastValidBlockHeight: number) {
  const intent = validateSolIntent(input), payer = new PublicKey(intent.payer)
  return new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight }).add(
    SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(intent.recipient), lamports: BigInt(intent.lamports) }),
    new TransactionInstruction({ programId: memoProgram, keys: [{ pubkey: payer, isSigner: true, isWritable: false }], data: Buffer.from(`${pluginId}:${intent.orderId}`) }),
  )
}
export function validatePreparedTransfer(pluginId: string, value: unknown) {
  const prepared = preparedSchema.parse(value)
  const expected = buildSolTransfer(pluginId, intentSchema.parse({ orderId: prepared.orderId, payer: prepared.payer, recipient: prepared.recipient, lamports: prepared.lamports, network: prepared.network }), prepared.blockhash, prepared.lastValidBlockHeight)
  if (hash(expected) !== prepared.messageHash || expected.serialize({ requireAllSignatures: false }).toString('base64') !== prepared.transactionBase64) invalid()
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
export async function prepareSolTransfer(pluginId: string, input: unknown): Promise<PreparedSolTransfer> {
  const intent = validateSolIntent(input)
  return withPaymentRpc(async connection => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized')
    const tx = buildSolTransfer(pluginId, intent, blockhash, lastValidBlockHeight)
    const [balance, fee] = await Promise.all([connection.getBalance(new PublicKey(intent.payer), 'confirmed'), connection.getFeeForMessage(tx.compileMessage(), 'confirmed')])
    if (fee.value === null) throw new Error('Unable to estimate payment fee')
    if (BigInt(balance) < BigInt(intent.lamports) + BigInt(fee.value)) throw new HttpError('PAYMENT_BALANCE_INSUFFICIENT', 409)
    return { ...intent, blockhash, lastValidBlockHeight, messageHash: hash(tx), transactionBase64: tx.serialize({ requireAllSignatures: false }).toString('base64') }
  })
}
export async function broadcastSolTransfer(pluginId: string, input: unknown) {
  const checked = validateSignedTransfer(pluginId, input)
  const result = await withPaymentRpc(c => c.sendRawTransaction(checked.transaction.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 }))
  if (result !== checked.signature) invalid()
  return { signature: result }
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
    return { status: result.meta.err ? 'FAILED' : 'FINALIZED', slot: result.slot }
  })
}
