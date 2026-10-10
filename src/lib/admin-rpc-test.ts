/**
 * @file admin-rpc-test.ts
 * @project SlothVault
 * @module Administrator RPC Test State
 * @description Owns independent cancellable RPC tests and publishes per-node outcomes to the shared settings UI.
 * @logic Start saved nodes concurrently, suppress duplicate tests, bound API waits, and discard invalidated or mismatched results.
 * @dependencies api-client, administrator RPC test API contract
 * @index_tags admin,rpc,parallel,cancellation,state
 * @author holic512
 */
import { apiFetch } from '@/lib/api-client'
import type { RpcConfigKey, RpcNodeTestResult } from '@/types/admin-rpc'

export type RpcNodeTestState = {
  endpoint: string
  pending: boolean
  result: RpcNodeTestResult | null
  error: Error | null
}
type RpcTestRequest = (key: RpcConfigKey, signal: AbortSignal) => Promise<RpcNodeTestResult>
const requestNodeTest: RpcTestRequest = (key, signal) => apiFetch('/api/admin/mm/config/rpc/test', {
  method: 'POST', body: JSON.stringify({ key }), signal,
})

export class RpcTestController {
  private states: Partial<Record<RpcConfigKey, RpcNodeTestState>> = {}
  private controllers = new Map<RpcConfigKey, AbortController>()
  private listeners = new Set<() => void>()

  constructor(private request: RpcTestRequest = requestNodeTest) {}

  getSnapshot = () => this.states
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(key: RpcConfigKey, state?: RpcNodeTestState) {
    this.states = { ...this.states }
    if (state) this.states[key] = state
    else delete this.states[key]
    for (const listener of this.listeners) listener()
  }

  invalidate(key: RpcConfigKey) {
    this.controllers.get(key)?.abort()
    this.controllers.delete(key)
    if (this.states[key]) this.publish(key)
  }

  clear() {
    for (const key of Object.keys(this.states) as RpcConfigKey[]) this.invalidate(key)
  }

  async test(key: RpcConfigKey, endpoint: string) {
    if (this.controllers.has(key) || !endpoint) return
    const controller = new AbortController()
    this.controllers.set(key, controller)
    this.publish(key, { endpoint, pending: true, result: null, error: null })
    const deadline = AbortSignal.timeout(12_000)
    try {
      const result = await this.request(key, AbortSignal.any([controller.signal, deadline]))
      if (this.controllers.get(key) !== controller) return
      if (result.key !== key || result.endpoint !== endpoint) throw new Error('RPC_CONFIGURATION_CHANGED')
      this.publish(key, { endpoint, pending: false, result, error: null })
    } catch (error) {
      if (this.controllers.get(key) !== controller) return
      this.publish(key, {
        endpoint, pending: false, result: null,
        error: deadline.aborted ? new Error('RPC_TEST_REQUEST_TIMEOUT') : error instanceof Error ? error : new Error('RPC_TEST_REQUEST_FAILED'),
      })
    } finally {
      if (this.controllers.get(key) === controller) this.controllers.delete(key)
    }
  }
}
