import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  getSystemUpdateInfo: vi.fn(),
}))

vi.mock('@/server/http/handler', () => ({
  defineRoute: <T>(handler: T) => handler,
}))
vi.mock('@/server/auth/session', () => ({
  requireAdminSession: mocks.requireAdminSession,
}))
vi.mock('@/server/services/system-update', () => ({
  getSystemUpdateInfo: mocks.getSystemUpdateInfo,
}))

import { GET } from '@/app/api/admin/mm/system-update/route'
import { HttpError } from '@/server/http/errors'

const context = { params: Promise.resolve({}) }

function updateRequest(refresh?: string) {
  const url = new URL('http://localhost/api/admin/mm/system-update')
  if (refresh !== undefined) url.searchParams.set('refresh', refresh)
  return Object.assign(new Request(url), { nextUrl: url })
}

describe('admin system update route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminSession.mockResolvedValue(undefined)
    mocks.getSystemUpdateInfo.mockResolvedValue({ status: 'UP_TO_DATE' })
  })

  it('uses the ordinary release cache when no manual refresh is requested', async () => {
    const request = updateRequest()
    const response = await GET(request as never, context)

    expect(response.status).toBe(200)
    expect(mocks.requireAdminSession).toHaveBeenCalledWith(request)
    expect(mocks.getSystemUpdateInfo).toHaveBeenCalledWith({ forceRefresh: false })
  })

  it('forces a fresh release check only for refresh=1', async () => {
    await GET(updateRequest('1') as never, context)
    expect(mocks.getSystemUpdateInfo).toHaveBeenCalledWith({ forceRefresh: true })

    mocks.getSystemUpdateInfo.mockClear()
    await GET(updateRequest('0') as never, context)
    expect(mocks.getSystemUpdateInfo).toHaveBeenCalledWith({ forceRefresh: false })
  })

  it('authenticates before requesting release data', async () => {
    mocks.requireAdminSession.mockRejectedValue(new HttpError('Unauthorized', 401, 401))

    await expect(GET(updateRequest('1') as never, context)).rejects.toBeInstanceOf(HttpError)
    expect(mocks.getSystemUpdateInfo).not.toHaveBeenCalled()
  })
})
