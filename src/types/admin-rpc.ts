/**
 * @file admin-rpc.ts
 * @project SlothVault
 * @module Administrator RPC Test Contract
 * @description Identifies the four configurable RPC nodes and their independent probe results.
 * @logic Share saved-node identifiers and normalized outcomes between administrator UI and server probes.
 * @dependencies None
 * @index_tags admin,rpc,configuration,health,contract
 * @author holic512
 */
export const RPC_NODES = [
  { key: 'SOLANA_MAINNET_RPC_PRIMARY', network: 'mainnet', fallback: false },
  { key: 'SOLANA_MAINNET_RPC_FALLBACK', network: 'mainnet', fallback: true },
  { key: 'SOLANA_DEVNET_RPC_PRIMARY', network: 'devnet', fallback: false },
  { key: 'SOLANA_DEVNET_RPC_FALLBACK', network: 'devnet', fallback: true },
] as const

export type RpcConfigKey = (typeof RPC_NODES)[number]['key']
export type RpcProbeStatus = 'success' | 'timeout' | 'error' | 'unconfigured'
export type RpcProbeErrorCode = 'HTTP_ERROR' | 'RPC_ERROR' | 'INVALID_RESPONSE' | 'NETWORK_ERROR'
export type RpcProbeResult = {
  status: RpcProbeStatus
  latencyMs: number | null
  errorCode: RpcProbeErrorCode | null
  httpStatus: number | null
}
export type RpcNodeTestResult = RpcProbeResult & {
  key: RpcConfigKey
  endpoint: string
  testedAt: string
}

export function isRpcConfigKey(key: string): key is RpcConfigKey {
  return RPC_NODES.some((node) => node.key === key)
}
