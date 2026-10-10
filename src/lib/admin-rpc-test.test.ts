import { describe, expect, it, vi } from 'vitest'

import { RpcTestController } from './admin-rpc-test'
import { RPC_NODES, type RpcConfigKey, type RpcNodeTestResult } from '@/types/admin-rpc'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function result(key: RpcConfigKey, endpoint = 'https://rpc.example.test'): RpcNodeTestResult {
  return { key, endpoint, testedAt: '2026-10-10T09:00:00Z', status: 'success', latencyMs: 42, errorCode: null, httpStatus: null }
}

describe('independent RPC test state', () => {
  it('starts four nodes together and publishes the fastest result before the remaining nodes finish', async () => {
    const jobs = RPC_NODES.map(() => deferred<RpcNodeTestResult>())
    const request = vi.fn((key: RpcConfigKey) => jobs[RPC_NODES.findIndex((node) => node.key === key)].promise)
    const controller = new RpcTestController(request)
    const promises = RPC_NODES.map(({ key }) => controller.test(key, 'https://rpc.example.test'))
    expect(request).toHaveBeenCalledTimes(4)
    expect(Object.values(controller.getSnapshot()).every((state) => state.pending)).toBe(true)
    jobs[2].resolve(result(RPC_NODES[2].key))
    await promises[2]
    expect(controller.getSnapshot()[RPC_NODES[2].key]?.result?.latencyMs).toBe(42)
    expect(controller.getSnapshot()[RPC_NODES[0].key]?.pending).toBe(true)
    jobs.forEach((job, index) => job.resolve(result(RPC_NODES[index].key)))
    await Promise.all(promises)
  })

  it('suppresses duplicate requests for one node and skips empty endpoints', async () => {
    const job = deferred<RpcNodeTestResult>()
    const request = vi.fn(() => job.promise)
    const controller = new RpcTestController(request)
    const pending = controller.test(RPC_NODES[0].key, 'https://rpc.example.test')
    await controller.test(RPC_NODES[0].key, 'https://rpc.example.test')
    await controller.test(RPC_NODES[1].key, '')
    expect(request).toHaveBeenCalledOnce()
    job.resolve(result(RPC_NODES[0].key))
    await pending
  })

  it('cancels an edited node and ignores its obsolete result even after a new test starts', async () => {
    const old = deferred<RpcNodeTestResult>()
    const next = deferred<RpcNodeTestResult>()
    const request = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const controller = new RpcTestController(request)
    const key = RPC_NODES[0].key
    const first = controller.test(key, 'https://rpc.example.test')
    const signal = request.mock.calls[0][1] as AbortSignal
    controller.invalidate(key)
    expect(signal.aborted).toBe(true)
    expect(controller.getSnapshot()[key]).toBeUndefined()
    const second = controller.test(key, 'https://new.example.test')
    old.resolve(result(key))
    await first
    expect(controller.getSnapshot()[key]?.pending).toBe(true)
    next.resolve(result(key, 'https://new.example.test'))
    await second
    expect(controller.getSnapshot()[key]?.result?.endpoint).toBe('https://new.example.test')
  })

  it('rejects a result from a server configuration different from the displayed saved address', async () => {
    const controller = new RpcTestController(async (key) => result(key, 'https://changed.example.test'))
    await controller.test(RPC_NODES[0].key, 'https://rpc.example.test')
    expect(controller.getSnapshot()[RPC_NODES[0].key]?.error?.message).toBe('RPC_CONFIGURATION_CHANGED')
    expect(controller.getSnapshot()[RPC_NODES[0].key]?.result).toBeNull()
  })

  it('isolates transport errors and clears all outstanding probes when the settings layout leaves', async () => {
    const job = deferred<RpcNodeTestResult>()
    const request = vi.fn().mockRejectedValueOnce(new Error('API unavailable')).mockReturnValueOnce(job.promise)
    const controller = new RpcTestController(request)
    await controller.test(RPC_NODES[0].key, 'https://rpc.example.test')
    expect(controller.getSnapshot()[RPC_NODES[0].key]?.error?.message).toBe('API unavailable')
    const second = controller.test(RPC_NODES[1].key, 'https://rpc.example.test')
    const signal = request.mock.calls[1][1] as AbortSignal
    controller.clear()
    expect(signal.aborted).toBe(true)
    expect(controller.getSnapshot()).toEqual({})
    job.resolve(result(RPC_NODES[1].key))
    await second
    expect(controller.getSnapshot()).toEqual({})
  })

  it('bounds an API request that never returns and allows the node to be retried afterwards', async () => {
    const deadline = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    try {
      const request = vi.fn((_key: RpcConfigKey, signal: AbortSignal) => new Promise<RpcNodeTestResult>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }))
      const controller = new RpcTestController(request)
      const key = RPC_NODES[0].key
      const pending = controller.test(key, 'https://rpc.example.test')
      expect(timeout).toHaveBeenCalledWith(12_000)
      deadline.abort(new DOMException('Request timed out', 'TimeoutError'))
      await pending
      expect(controller.getSnapshot()[key]?.error?.message).toBe('RPC_TEST_REQUEST_TIMEOUT')
      expect(controller.getSnapshot()[key]?.pending).toBe(false)
      request.mockResolvedValue(result(key))
      await controller.test(key, 'https://rpc.example.test')
      expect(controller.getSnapshot()[key]?.result?.status).toBe('success')
    } finally { timeout.mockRestore() }
  })
})
