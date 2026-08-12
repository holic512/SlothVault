import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HttpError } from '@/server/http/errors'

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
}))

vi.mock('@/server/services/system-config', () => ({
  getSolanaNetworkProfile: mocks.profile,
}))

import { withEvidenceRpc } from '@/server/services/release-evidence-chain'

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
