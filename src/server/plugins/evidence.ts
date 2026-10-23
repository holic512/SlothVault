/**
 * @file evidence.ts
 * @project SlothVault
 * @module Plugin Mainnet Evidence Capability
 * @description Exposes the existing Memo transaction and RPC safety boundary to authorized plugins.
 * @logic Bind each prepared message to a plugin protocol, verify exact signed bytes and Mainnet genesis, and distinguish finality from ambiguous broadcasts.
 * @dependencies solana-memo-transaction, release-evidence-chain, system-config, zod
 * @index_tags plugins,evidence,mainnet,signature,finality
 * @author holic512
 */
import 'server-only'
import { PublicKey } from '@solana/web3.js'
import { z } from 'zod'
import type { PreparedMemoEvidence, MemoEvidenceObservation } from '@slothvault/plugin-sdk/protocol'
import { HttpError } from '@/server/http/errors'
import { requireEnabledSolanaNetwork } from '@/server/services/system-config'
import { buildMemoTransaction, serializePreparedMemoTransaction, memoTransactionMessageHash, parseSignedMemoTransaction, assertSignedMemoTransaction } from '@/server/services/solana-memo-transaction'
import { withEvidenceRpc, finalizedEvidenceTransaction } from '@/server/services/release-evidence-chain'
const rpcOptions = { mainnetOnly: true, timeoutMs: 2200 }
const intent = z.object({ memo: z.string().min(1).max(700), signerAddress: z.string().min(32).max(44) }).strict()
const preparedSchema = intent.extend({ transactionBase64: z.string().max(1700), messageHash: z.string().regex(/^[a-f0-9]{64}$/), blockhash: z.string().min(32).max(44), lastValidBlockHeight: z.string().regex(/^[1-9]\d{0,14}$/), feeLamports: z.number().int().nonnegative(), balanceLamports: z.number().int().nonnegative() }).strict()
function checkNamespace(pluginId: string, memo: string) {
  let data: unknown
  try { data = JSON.parse(memo) } catch { throw new HttpError('Evidence memo must be a JSON digest envelope', 400) }
  if (!data || typeof data !== 'object' || (data as { protocol?: unknown }).protocol !== pluginId || Buffer.byteLength(memo) > 700) throw new HttpError('Evidence protocol must match the owning plugin', 400)
}
export async function preparePluginEvidence(pluginId: string, value: unknown): Promise<PreparedMemoEvidence> {
  const input = intent.parse(value)
  checkNamespace(pluginId, input.memo)
  let signer: PublicKey
  try { signer = new PublicKey(input.signerAddress) } catch { throw new HttpError('Invalid evidence wallet', 400) }
  await requireEnabledSolanaNetwork('mainnet')
  return withEvidenceRpc('mainnet', async connection => {
    const latest = await connection.getLatestBlockhash('confirmed')
    const transaction = buildMemoTransaction({ memo: input.memo, signer, ...latest })
    const [fee, balance] = await Promise.all([connection.getFeeForMessage(transaction.compileMessage()), connection.getBalance(signer, 'confirmed')])
    if (fee.value === null) throw new HttpError('Unable to estimate evidence fee; prepare again', 409)
    if (balance < fee.value) throw new HttpError('钱包余额不足以支付存证手续费', 400)
    return { ...input, transactionBase64: serializePreparedMemoTransaction(transaction), messageHash: memoTransactionMessageHash(transaction), blockhash: latest.blockhash, lastValidBlockHeight: String(latest.lastValidBlockHeight), feeLamports: fee.value, balanceLamports: balance }
  }, rpcOptions)
}
function prepared(pluginId: string, value: unknown) {
  const item = preparedSchema.parse(value)
  checkNamespace(pluginId, item.memo)
  const rebuilt = buildMemoTransaction({ memo: item.memo, signer: new PublicKey(item.signerAddress), blockhash: item.blockhash, lastValidBlockHeight: Number(item.lastValidBlockHeight) })
  if (memoTransactionMessageHash(rebuilt) !== item.messageHash || memoTransactionMessageHash(parseSignedMemoTransaction(item.transactionBase64)) !== item.messageHash) throw new HttpError('Prepared evidence message was altered', 409)
  return item
}
export function validatePluginEvidence(pluginId: string, value: unknown) {
  const input = z.object({ prepared: z.unknown(), signedTransactionBase64: z.string().max(1700) }).strict().parse(value)
  const item = prepared(pluginId, input.prepared)
  const transaction = parseSignedMemoTransaction(input.signedTransactionBase64)
  const signature = assertSignedMemoTransaction({ transaction, memo: item.memo, signerAddress: item.signerAddress, messageHash: item.messageHash, recentBlockhash: item.blockhash })
  return { signature, transaction, prepared: item }
}
export async function broadcastPluginEvidence(pluginId: string, value: unknown) {
  const checked = validatePluginEvidence(pluginId, value)
  await requireEnabledSolanaNetwork('mainnet')
  return withEvidenceRpc('mainnet', async connection => {
    const signature = await connection.sendRawTransaction(checked.transaction.serialize(), { skipPreflight: false, maxRetries: 0 })
    if (signature !== checked.signature) throw new HttpError('Evidence broadcast signature mismatch; reconcile the original signature', 502)
    return { signature }
  }, rpcOptions)
}
export async function observePluginEvidence(pluginId: string, value: unknown): Promise<MemoEvidenceObservation> {
  const input = z.object({ prepared: z.unknown(), signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/) }).strict().parse(value)
  const item = prepared(pluginId, input.prepared)
  const chain = await finalizedEvidenceTransaction('mainnet', input.signature, rpcOptions)
  if (chain) {
    if (chain.failed) return { status: 'FAILED', blockTime: chain.blockTime?.toISOString() ?? null, error: '链上交易执行失败' }
    const signature = assertSignedMemoTransaction({ transaction: chain.transaction, memo: item.memo, signerAddress: item.signerAddress, messageHash: item.messageHash, recentBlockhash: item.blockhash })
    if (signature !== input.signature) throw new HttpError('Evidence receipt signature mismatch', 409)
    return { status: 'FINALIZED', blockTime: chain.blockTime?.toISOString() ?? null }
  }
  return withEvidenceRpc('mainnet', async connection => {
    const statuses = await connection.getSignatureStatuses([input.signature], { searchTransactionHistory: true })
    const status = statuses.value[0]
    // A confirmed transaction can still finalize after its blockhash expires.
    if (status) return { status: status.err && status.confirmationStatus === 'finalized' ? 'FAILED' : 'PENDING', blockTime: null }
    const height = await connection.getBlockHeight('finalized')
    return { status: height > Number(item.lastValidBlockHeight) ? 'EXPIRED' : 'PENDING', blockTime: null }
  }, rpcOptions)
}
