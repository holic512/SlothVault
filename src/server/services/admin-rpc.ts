/**
 * @file admin-rpc.ts
 * @project SlothVault
 * @module Administrator RPC Probes
 * @description Tests one saved administrator RPC node without changing configuration or health snapshots.
 * @logic Resolve the selected stored address with runtime defaults and return its bounded probe independently of other nodes.
 * @dependencies system-config, release-evidence-chain
 * @index_tags admin,rpc,probe,read-only,parallel
 * @author holic512
 */
import 'server-only'

import { testEvidenceEndpoint } from '@/server/services/release-evidence-chain'
import { getConfigValue, resolveSolanaRpcUrl } from '@/server/services/system-config'
import { RPC_NODES, type RpcConfigKey, type RpcNodeTestResult } from '@/types/admin-rpc'

export async function testAdminRpcNode(key: RpcConfigKey, signal?: AbortSignal): Promise<RpcNodeTestResult> {
  const node = RPC_NODES.find((item) => item.key === key)!
  const endpoint = resolveSolanaRpcUrl(node.network, node.fallback, await getConfigValue(key))
  const { status, latencyMs, errorCode, httpStatus } = await testEvidenceEndpoint(endpoint, signal)
  return { key, endpoint, testedAt: new Date().toISOString(), status, latencyMs, errorCode, httpStatus }
}
