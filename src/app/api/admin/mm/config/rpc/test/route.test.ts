import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireAdminSession: vi.fn(), testAdminRpcNode: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireAdminSession: mocks.requireAdminSession }))
vi.mock('@/server/services/admin-rpc', () => ({ testAdminRpcNode: mocks.testAdminRpcNode }))
vi.mock('@/server/database/runtime-health', () => ({
  readRuntimeInstallationPublicStatus: async () => ({ status: 'INSTALLED' }),
  isDatabaseConnectivityError: () => false,
  markInstalledDatabaseUnavailable: vi.fn(),
}))
vi.mock('@/server/services/admin-backup/recovery-state', () => ({ backupRecoveryError: () => null }))

import { POST } from './route'
import { HttpError } from '@/server/http/errors'
import { RPC_NODES, type RpcConfigKey } from '@/types/admin-rpc'

const context = { params: Promise.resolve({}) }
function request(body: unknown) {
  const url = new URL('http://localhost/api/admin/mm/config/rpc/test')
  return Object.assign(new Request(url, { method: 'POST', body: JSON.stringify(body) }), { nextUrl: url })
}
function result(key: RpcConfigKey) {
  return { key, endpoint: 'https://rpc.example.test', status: 'success', latencyMs: 17, errorCode: null, httpStatus: null, testedAt: '2026-10-10T09:00:00Z' }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdminSession.mockResolvedValue(undefined)
  mocks.testAdminRpcNode.mockImplementation(async (key) => result(key))
})

describe('authenticated concurrent RPC test route', () => {
  it('authenticates before resolving a node and marks responses as uncached', async () => {
    const input = request({ key: RPC_NODES[0].key })
    const response = await POST(input as never, context)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.requireAdminSession).toHaveBeenCalledWith(input)
    expect(mocks.testAdminRpcNode).toHaveBeenCalledWith(RPC_NODES[0].key, input.signal)
    expect(await response.json()).toMatchObject({ code: 0, data: { status: 'success' } })
    mocks.testAdminRpcNode.mockClear()
    mocks.requireAdminSession.mockRejectedValue(new HttpError('Unauthorized', 401, 401))
    expect((await POST(request({ key: RPC_NODES[0].key }) as never, context)).status).toBe(401)
    expect(mocks.testAdminRpcNode).not.toHaveBeenCalled()
  })

  it.each([{ key: 'SOLANA_DEFAULT_NETWORK' }, { key: RPC_NODES[0].key, url: 'https://arbitrary.example.test' }, {}, { key: 123 }])
    ('rejects requests outside the saved-node contract: %j', async (body) => {
      expect((await POST(request(body) as never, context)).status).toBe(400)
      expect(mocks.testAdminRpcNode).not.toHaveBeenCalled()
    })

  it('admits four probes through the real shared route lock and returns a fast result independently', async () => {
    const finish = new Map<RpcConfigKey, () => void>()
    mocks.testAdminRpcNode.mockImplementation((key: RpcConfigKey) => new Promise((resolve) => {
      finish.set(key, () => resolve(result(key)))
    }))
    const responses = RPC_NODES.map(({ key }) => POST(request({ key }) as never, context))
    let firstFinished = false
    void responses[0].then(() => { firstFinished = true })
    try {
      await vi.waitFor(() => expect(finish.size).toBe(4))
      finish.get(RPC_NODES[2].key)!()
      expect((await responses[2]).status).toBe(200)
      expect(firstFinished).toBe(false)
    } finally {
      for (const complete of finish.values()) complete()
      await Promise.all(responses)
    }
  })
})
