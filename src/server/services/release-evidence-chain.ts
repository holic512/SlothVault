/**
 * @file release-evidence-chain.ts
 * @project SlothVault
 * @module Release Evidence Chain Runtime
 * @description Executes Solana evidence operations, extracts finalized transaction facts, and probes individual RPC endpoints with an HTTP deadline.
 * @logic Fail over only on connection failures during evidence operations; probe one endpoint without retries, bound the entire response, and normalize errors without response bodies.
 * @dependencies @solana/web3.js, release evidence network configuration
 * @index_tags evidence,solana,rpc,failover,finalization,verification
 * @author holic512
 */
import 'server-only'

import { Connection, Message, SolanaJSONRPCError, Transaction } from '@solana/web3.js'

import { HttpError } from '@/server/http/errors'
import {
  getSolanaNetworkProfile,
  type SolanaNetwork,
} from '@/server/services/system-config'
import type { RpcProbeResult } from '@/types/admin-rpc'

export const RPC_PROBE_TIMEOUT_MS = 8_000

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

export async function testEvidenceEndpoint(url: string, signal?: AbortSignal): Promise<RpcProbeResult & {
  configured: boolean
  ok: boolean
  error: string | null
}> {
  if (!url) return { configured: false, ok: false, status: 'unconfigured', latencyMs: null, error: null, errorCode: null, httpStatus: null }
  const started = performance.now()
  const controller = new AbortController()
  let timedOut = false
  let httpStatus: number | null = null
  let fetchFailed = false
  const cancel = () => controller.abort(new Error('RPC probe cancelled'))
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('RPC probe timed out'))
  }, RPC_PROBE_TIMEOUT_MS)
  try {
    const connection = new Connection(url, {
      commitment: 'confirmed',
      disableRetryOnRateLimit: true,
      fetch: async (input, init) => {
        try {
          const response = await fetch(input, { ...init, signal: controller.signal })
          if (!response.ok) httpStatus = response.status
          return response
        } catch (error) {
          fetchFailed = true
          throw error
        }
      },
    })
    await connection.getLatestBlockhash('confirmed')
    return { configured: true, ok: true, status: 'success', latencyMs: Math.round(performance.now() - started), error: null, errorCode: null, httpStatus: null }
  } catch (error) {
    const errorCode = httpStatus !== null ? 'HTTP_ERROR'
      : error instanceof SolanaJSONRPCError || (error instanceof Error && error.message.includes('SolanaJSONRPCError:')) ? 'RPC_ERROR'
        : fetchFailed || controller.signal.aborted ? 'NETWORK_ERROR' : 'INVALID_RESPONSE'
    return {
      configured: true,
      ok: false,
      status: timedOut ? 'timeout' : 'error',
      latencyMs: Math.round(performance.now() - started),
      error: timedOut ? 'RPC probe timed out' : httpStatus !== null ? `RPC HTTP ${httpStatus}` : errorCode,
      errorCode: timedOut ? null : errorCode,
      httpStatus,
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
