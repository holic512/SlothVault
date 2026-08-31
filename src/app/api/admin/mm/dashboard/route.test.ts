import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  getAdminDashboard: vi.fn(),
}))

vi.mock('@/server/http/handler', () => ({
  defineRoute: <T>(handler: T) => handler,
}))
vi.mock('@/server/auth/session', () => ({
  requireAdminSession: mocks.requireAdminSession,
}))
vi.mock('@/server/services/admin-dashboard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/admin-dashboard')>()
  return {
    ...actual,
    getAdminDashboard: mocks.getAdminDashboard,
  }
})

import { GET } from '@/app/api/admin/mm/dashboard/route'
import { HttpError } from '@/server/http/errors'

const context = { params: Promise.resolve({}) }

function dashboardRequest(range?: string) {
  const url = new URL('http://localhost/api/admin/mm/dashboard')
  if (range !== undefined) url.searchParams.set('range', range)
  return Object.assign(new Request(url), { nextUrl: url })
}

describe('admin dashboard route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminSession.mockResolvedValue(undefined)
    mocks.getAdminDashboard.mockResolvedValue({ range: { days: 30 } })
  })

  it('authenticates the request and defaults the trend window to 30 days', async () => {
    const request = dashboardRequest()
    const response = await GET(request as never, context)

    expect(response.status).toBe(200)
    expect(mocks.requireAdminSession).toHaveBeenCalledWith(request)
    expect(mocks.getAdminDashboard).toHaveBeenCalledWith({ range: 30 })
  })

  it.each([['7', 7], ['30', 30], ['90', 90]])('accepts range=%s', async (rawRange, range) => {
    await GET(dashboardRequest(rawRange) as never, context)

    expect(mocks.getAdminDashboard).toHaveBeenCalledWith({ range })
  })

  it('rejects an unsupported trend window before querying the dashboard service', async () => {
    await expect(GET(dashboardRequest('31') as never, context))
      .rejects.toBeInstanceOf(HttpError)
    expect(mocks.getAdminDashboard).not.toHaveBeenCalled()
  })

  it('does not query dashboard data when the administrator session check fails', async () => {
    mocks.requireAdminSession.mockRejectedValue(new HttpError('Unauthorized', 401, 401))

    await expect(GET(dashboardRequest() as never, context))
      .rejects.toBeInstanceOf(HttpError)
    expect(mocks.getAdminDashboard).not.toHaveBeenCalled()
  })
})
