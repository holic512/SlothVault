import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), user: { findUnique: vi.fn() } }))
vi.mock('@/server/plugins/manager', () => ({ invokePluginService: mocks.invoke }))
vi.mock('@/server/prisma', () => ({ prisma: { user: mocks.user } }))
import { issueGiftCardBatch, redeemGiftCard, listGiftCardBatches } from '@/server/services/points'

describe('legacy gift-card entry points', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.findUnique.mockResolvedValue({ id: 7, role: 'ADMIN', status: 1 }) })
  it('keeps issuance and MCP listing as declared plugin service calls', async () => {
    await issueGiftCardBatch({ adminId: 7, name: 'Batch', points: 10, quantity: 2 })
    expect(mocks.invoke).toHaveBeenCalledWith('slothvault.gift-cards', 'issue', { actor: { userId: 7, role: 'ADMIN' }, input: { name: 'Batch', points: 10, quantity: 2, expiresAt: null } })
    await listGiftCardBatches(1, 20, 7)
    expect(mocks.invoke).toHaveBeenLastCalledWith('slothvault.gift-cards', 'list', { actor: { userId: 7, role: 'ADMIN' }, input: { page: 1, pageSize: 20 } })
  })
  it('does not bypass a disabled plugin or fall back to core redemption', async () => {
    mocks.user.findUnique.mockResolvedValue({ id: 7, role: 'USER', status: 1 })
    mocks.invoke.mockRejectedValueOnce(new Error('Plugin is disabled'))
    await expect(redeemGiftCard(7, 'SV-CODE')).rejects.toThrow('disabled')
    expect(mocks.invoke).toHaveBeenCalledWith('slothvault.gift-cards', 'redeem', { actor: { userId: 7, role: 'USER' }, input: { code: 'SV-CODE' } })
  })
  it('rejects deleted, suspended and non-administrator issuers before plugin dispatch', async () => {
    for (const user of [null, { id: 7, role: 'ADMIN', status: 0 }, { id: 7, role: 'USER', status: 1 }]) {
      mocks.user.findUnique.mockResolvedValue(user)
      await expect(issueGiftCardBatch({ adminId: 7, name: 'Batch', points: 10, quantity: 2 })).rejects.toThrow('Unauthorized')
    }
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
