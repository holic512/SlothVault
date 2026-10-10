import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HttpError } from '@/server/http/errors'

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
}))

vi.mock('@/server/services/system-config', () => ({
  getSolanaNetworkProfile: mocks.profile,
}))

import { RPC_PROBE_TIMEOUT_MS, testEvidenceEndpoint, withEvidenceRpc } from '@/server/services/release-evidence-chain'

describe('release evidence RPC failover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.profile.mockResolvedValue({
      primaryUrl: 'https://primary.example',
      fallbackUrl: 'https://fallback.example',
    })
  })

  it('uses the fallback only after a connection-level primary failure', async () => {
    const endpoints: string[] = []
    const result = await withEvidenceRpc('devnet', async (connection) => {
      endpoints.push(connection.rpcEndpoint)
      if (connection.rpcEndpoint.includes('primary')) throw new Error('fetch failed: timeout')
      return 'fallback-result'
    })

    expect(result).toBe('fallback-result')
    expect(endpoints).toEqual(['https://primary.example', 'https://fallback.example'])
  })

  it('does not mask business validation or chain transaction failures with another endpoint', async () => {
    const businessOperation = vi.fn().mockRejectedValue(
      new HttpError('Wallet balance is insufficient', 400, 400),
    )
    await expect(withEvidenceRpc('mainnet', businessOperation)).rejects.toThrow(
      'Wallet balance is insufficient',
    )
    expect(businessOperation).toHaveBeenCalledOnce()

    const chainOperation = vi.fn().mockRejectedValue(
      new Error('Transaction simulation failed: custom program error'),
    )
    await expect(withEvidenceRpc('mainnet', chainOperation)).rejects.toThrow(
      'Transaction simulation failed',
    )
    expect(chainOperation).toHaveBeenCalledOnce()
  })
})

describe('bounded individual RPC probes', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
  function rpcResponse(init: RequestInit | undefined, fields: object) {
    const { id } = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, ...fields }), { headers: { 'Content-Type': 'application/json' } })
  }

  it('returns a measured latency for a valid blockhash and does not contact empty endpoints', async () => {
    const fetch = vi.fn(async (_input, init) => rpcResponse(init, {
      result: { context: { slot: 1 }, value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 } },
    }))
    vi.stubGlobal('fetch', fetch)
    const result = await testEvidenceEndpoint('https://rpc.example.test')
    expect(result).toMatchObject({ configured: true, ok: true, status: 'success', error: null })
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(JSON.parse(fetch.mock.calls[0][1].body).method).toBe('getLatestBlockhash')
    expect(await testEvidenceEndpoint('')).toMatchObject({ status: 'unconfigured', latencyMs: null })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([429, 401, 403, 503])('reports HTTP %s without retries or exposing the response body', async (status) => {
    const fetch = vi.fn(async () => new Response('private-upstream-details', { status }))
    vi.stubGlobal('fetch', fetch)
    const result = await testEvidenceEndpoint('https://rpc.example.test?key=example')
    expect(result).toMatchObject({ status: 'error', httpStatus: status, errorCode: 'HTTP_ERROR', error: `RPC HTTP ${status}` })
    expect(JSON.stringify(result)).not.toContain('private-upstream-details')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('distinguishes RPC errors, malformed responses, and network failures', async () => {
    const fetch = vi.fn(async (_input, init) => rpcResponse(init, { error: { code: -32603, message: 'private RPC details' } }))
    vi.stubGlobal('fetch', fetch)
    expect(await testEvidenceEndpoint('https://rpc.example.test')).toMatchObject({ status: 'error', errorCode: 'RPC_ERROR', error: 'RPC_ERROR' })
    fetch.mockImplementation(async () => new Response('{invalid'))
    expect(await testEvidenceEndpoint('https://rpc.example.test')).toMatchObject({ status: 'error', errorCode: 'INVALID_RESPONSE' })
    fetch.mockRejectedValue(new TypeError('fetch failed'))
    expect(await testEvidenceEndpoint('https://rpc.example.test')).toMatchObject({ status: 'error', errorCode: 'NETWORK_ERROR' })
  })

  it.each(['headers', 'body'])('aborts a request hanging during %s at the eight-second deadline', async (stage) => {
    vi.useFakeTimers()
    let signal!: AbortSignal
    const fetch = vi.fn(async (_input, init: RequestInit) => {
      signal = init.signal!
      const waitForAbort = () => new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
      if (stage === 'headers') { await waitForAbort(); throw new Error('unreachable') }
      return { ok: true, status: 200, text: waitForAbort } as Response
    })
    vi.stubGlobal('fetch', fetch)
    const pending = testEvidenceEndpoint('https://rpc.example.test')
    await vi.advanceTimersByTimeAsync(RPC_PROBE_TIMEOUT_MS - 1)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toMatchObject({ status: 'timeout', ok: false, latencyMs: RPC_PROBE_TIMEOUT_MS })
    expect(signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('forwards request cancellation and cleans up its deadline', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_input, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })))
    const pending = testEvidenceEndpoint('https://rpc.example.test', controller.signal)
    controller.abort()
    expect(await pending).toMatchObject({ status: 'error', errorCode: 'NETWORK_ERROR' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
