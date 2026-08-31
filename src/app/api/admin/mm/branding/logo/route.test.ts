import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  uploadSystemLogo: vi.fn(),
}))

vi.mock('@/server/http/handler', () => ({
  defineRoute: <T>(handler: T) => handler,
}))
vi.mock('@/server/auth/session', () => ({
  requireAdminSession: mocks.requireAdminSession,
}))
vi.mock('@/server/services/admin-files', () => ({
  uploadSystemLogo: mocks.uploadSystemLogo,
}))

import { POST } from '@/app/api/admin/mm/branding/logo/route'

const context = { params: Promise.resolve({}) }

function logoRequest(syncFavicon: string) {
  return Object.assign(
    new Request(`http://localhost/api/admin/mm/branding/logo?syncFavicon=${syncFavicon}`, {
      method: 'POST',
      body: new FormData(),
    }),
    { nextUrl: new URL(`http://localhost/api/admin/mm/branding/logo?syncFavicon=${syncFavicon}`) },
  )
}

describe('system-logo synchronization route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminSession.mockResolvedValue(undefined)
    mocks.uploadSystemLogo.mockResolvedValue({ logo: { filePath: 'uploads/system-logo/logo.png' }, favicon: null })
  })

  it.each([
    ['true', true],
    ['false', false],
  ])('passes the explicit %s synchronization choice to storage', async (value, expected) => {
    const request = logoRequest(value)
    const response = await POST(request as never, context)

    expect(response.status).toBe(201)
    expect(mocks.uploadSystemLogo).toHaveBeenCalledWith(request, expected)
  })

  it('rejects missing or malformed synchronization choices', async () => {
    await expect(POST(logoRequest('yes') as never, context))
      .rejects.toMatchObject({ status: 400 })
    expect(mocks.uploadSystemLogo).not.toHaveBeenCalled()
  })
})
