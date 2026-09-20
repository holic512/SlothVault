import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

const mocks = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(),
  getMembershipAccountData: vi.fn(),
  purchaseMembership: vi.fn(),
  requireUserSession: vi.fn(),
}))

vi.mock('@/server/http/handler', () => ({
  defineRoute: <T>(handler: T) => handler,
}))
vi.mock('@/server/auth/session', () => ({
  requireUserSession: mocks.requireUserSession,
}))
vi.mock('@/server/short-lived-state', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}))
vi.mock('@/server/services/membership', () => ({
  getMembershipAccountData: mocks.getMembershipAccountData,
  purchaseMembership: mocks.purchaseMembership,
}))

import { GET, POST } from '@/app/api/account/membership/route'
import { HttpError } from '@/server/http/errors'

const context = { params: Promise.resolve({}) }

function request(method: 'GET' | 'POST', body?: unknown) {
  const url = new URL('http://localhost/api/account/membership')
  return Object.assign(new Request(url, {
    method,
    headers: { 'x-forwarded-for': '203.0.113.9' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { nextUrl: url })
}

describe('account membership route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireUserSession.mockResolvedValue({ userId: 8 })
    mocks.getMembershipAccountData.mockResolvedValue({
      pointsBalance: 80,
      currentMembership: null,
      levels: [],
      grants: [],
    })
    mocks.purchaseMembership.mockResolvedValue({
      pointsBalance: 50,
      membership: { id: '2', name: 'VIP', rank: 2, expiresAt: null, source: 'POINT_PURCHASE' },
      grant: { id: '9' },
    })
  })

  it('returns the authenticated account membership state', async () => {
    const incoming = request('GET')
    const response = await GET(incoming as never, context)

    expect(response.status).toBe(200)
    expect(mocks.requireUserSession).toHaveBeenCalledWith(incoming)
    expect(mocks.getMembershipAccountData).toHaveBeenCalledWith(8)
    await expect(response.json()).resolves.toMatchObject({
      code: 0,
      data: { pointsBalance: 80, currentMembership: null },
    })
  })

  it('rate-limits and purchases the selected level for the authenticated user', async () => {
    const incoming = request('POST', { membershipLevelId: 2 })
    const response = await POST(incoming as never, context)

    expect(response.status).toBe(200)
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'membership-purchase',
      identity: '8:203.0.113.9',
    }))
    expect(mocks.purchaseMembership).toHaveBeenCalledTimes(1)
    expect(mocks.purchaseMembership).toHaveBeenCalledWith({ userId: 8, membershipLevelId: 2 })
    await expect(response.json()).resolves.toMatchObject({
      code: 0,
      message: 'purchased',
      data: { pointsBalance: 50, membership: { id: '2', rank: 2 } },
    })
  })

  it('propagates a lower-level conflict without retrying the purchase', async () => {
    const conflict = new HttpError(
      'Cannot purchase a lower membership level while a higher level is active',
      409,
      409,
    )
    mocks.purchaseMembership.mockRejectedValue(conflict)

    await expect(POST(request('POST', { membershipLevelId: 1 }) as never, context))
      .rejects.toBe(conflict)
    expect(mocks.purchaseMembership).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid level id before entering the purchase service', async () => {
    await expect(POST(request('POST', { membershipLevelId: 0 }) as never, context))
      .rejects.toBeInstanceOf(ZodError)
    expect(mocks.purchaseMembership).not.toHaveBeenCalled()
  })
})
