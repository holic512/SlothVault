import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), probe: vi.fn() }))
vi.mock('@/server/prisma', () => ({ prisma: { systemConfig: { findUnique: mocks.findUnique } } }))
vi.mock('@/server/services/release-evidence-chain', () => ({ testEvidenceEndpoint: mocks.probe }))

import { testAdminRpcNode } from './admin-rpc'
import { getSolanaNetworkProfile } from './system-config'
import { RPC_NODES } from '@/types/admin-rpc'

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of ['SOLANA_RPC_URL', 'SOLANA_MAINNET_RPC_FALLBACK', 'SOLANA_DEVNET_RPC_URL', 'SOLANA_DEVNET_RPC_FALLBACK']) vi.stubEnv(key, '')
  mocks.findUnique.mockResolvedValue(null)
  mocks.probe.mockResolvedValue({ status: 'success', latencyMs: 24, errorCode: null, httpStatus: null })
})
afterEach(() => vi.unstubAllEnvs())

describe('saved administrator RPC probes', () => {
  it.each(RPC_NODES)('uses only the saved $key address and forwards cancellation', async ({ key }) => {
    mocks.findUnique.mockResolvedValue({ configValue: 'https://saved.example.test' })
    const signal = new AbortController().signal
    await expect(testAdminRpcNode(key, signal)).resolves.toMatchObject({
      key, endpoint: 'https://saved.example.test', status: 'success', latencyMs: 24,
    })
    expect(mocks.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { configKey: key }, select: { configValue: true } })
    expect(mocks.probe).toHaveBeenCalledExactlyOnceWith('https://saved.example.test', signal)
  })

  it('resolves stored, environment, and public defaults consistently with runtime network profiles', async () => {
    vi.stubEnv('SOLANA_RPC_URL', 'https://environment.example.test')
    const key = 'SOLANA_MAINNET_RPC_PRIMARY'
    expect((await testAdminRpcNode(key)).endpoint).toBe('https://environment.example.test')
    expect((await getSolanaNetworkProfile('mainnet')).primaryUrl).toBe('https://environment.example.test')
    mocks.findUnique.mockImplementation(async ({ where }) => where.configKey === key ? { configValue: 'https://stored.example.test' } : null)
    expect((await testAdminRpcNode(key)).endpoint).toBe('https://stored.example.test')
    expect((await getSolanaNetworkProfile('mainnet')).primaryUrl).toBe('https://stored.example.test')
    mocks.findUnique.mockResolvedValue(null)
    vi.stubEnv('SOLANA_RPC_URL', '')
    expect((await testAdminRpcNode(key)).endpoint).toBe('https://api.mainnet-beta.solana.com/')
    expect((await getSolanaNetworkProfile('devnet')).primaryUrl).toBe('https://api.devnet.solana.com')
  })

  it('leaves empty fallbacks unconfigured and uses configured environment fallbacks', async () => {
    mocks.probe.mockResolvedValue({ status: 'unconfigured', latencyMs: null, errorCode: null, httpStatus: null })
    expect((await testAdminRpcNode('SOLANA_DEVNET_RPC_FALLBACK')).endpoint).toBe('')
    vi.stubEnv('SOLANA_DEVNET_RPC_FALLBACK', 'https://fallback.example.test')
    expect((await testAdminRpcNode('SOLANA_DEVNET_RPC_FALLBACK')).endpoint).toBe('https://fallback.example.test')
  })
})
