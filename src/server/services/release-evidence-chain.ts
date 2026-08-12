/**
 * @file release-evidence-chain.ts
 * @project SlothVault
 * @module Release Evidence Chain Runtime
 * @description Executes Solana evidence RPC operations with bounded primary-to-fallback failover and extracts finalized transaction facts.
 * @logic Retry only connection-level failures on the configured fallback, never mask chain/business failures, and return normalized fee, slot, time, message, and signature evidence.
 * @dependencies @solana/web3.js, release evidence network configuration
 * @index_tags evidence,solana,rpc,failover,finalization,verification
 * @author holic512
 */
import 'server-only'

import { Connection, Message, Transaction } from '@solana/web3.js'

import { HttpError } from '@/server/http/errors'
import {
  getSolanaNetworkProfile,
  type SolanaNetwork,
} from '@/server/services/system-config'

function rpcConnection(url: string) {
  return new Connection(url, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 45_000,
  })
}

export function isEvidenceRpcConnectionFailure(error: unknown) {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /fetch|network|socket|timeout|timed out|ECONN|ENOTFOUND|429|503|502|504|failed to get/i.test(text)
}

export async function withEvidenceRpc<T>(
  network: SolanaNetwork,
  operation: (connection: Connection) => Promise<T>,
) {
  const profile = await getSolanaNetworkProfile(network)
  try {
    return await operation(rpcConnection(profile.primaryUrl))
  } catch (error) {
    if (!profile.fallbackUrl || !isEvidenceRpcConnectionFailure(error)) throw error
    return operation(rpcConnection(profile.fallbackUrl))
  }
}

export function evidenceRpcError(error: unknown, operation: string): never {
  if (error instanceof HttpError) throw error
  console.error(`[release-evidence] ${operation} failed`, error)
  if (isEvidenceRpcConnectionFailure(error)) {
    throw new HttpError('Solana RPC is unavailable; the evidence record can be reconciled later', 503, 503)
  }
  throw new HttpError(`Unable to ${operation}`, 500, 500)
}

export async function finalizedEvidenceTransaction(
  network: SolanaNetwork,
  signature: string,
) {
  return withEvidenceRpc(network, async (connection) => {
    const transaction = await connection.getTransaction(signature, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    })
    if (!transaction) return null
    if (transaction.version !== 'legacy') {
      throw new HttpError('Evidence transaction must use the legacy message format', 409, 409)
    }
    const legacy = Transaction.populate(
      transaction.transaction.message as Message,
      transaction.transaction.signatures,
    )
    return {
      transaction: legacy,
      slot: BigInt(transaction.slot),
      blockTime: transaction.blockTime == null
        ? null
        : new Date(transaction.blockTime * 1_000),
      feeLamports: BigInt(transaction.meta?.fee ?? 0),
      failed: transaction.meta?.err != null,
    }
  })
}

export async function testEvidenceEndpoint(url: string) {
  if (!url) return { configured: false, ok: false, latencyMs: null, error: null }
  const started = Date.now()
  try {
    await rpcConnection(url).getLatestBlockhash('confirmed')
    return { configured: true, ok: true, latencyMs: Date.now() - started, error: null }
  } catch (error) {
    return {
      configured: true,
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error
        ? error.message.replaceAll(url, '[RPC endpoint]').slice(0, 180)
        : 'RPC test failed',
    }
  }
}
