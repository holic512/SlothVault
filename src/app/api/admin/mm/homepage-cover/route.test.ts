import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireAdminSession: vi.fn(), get: vi.fn(), save: vi.fn() }))
vi.mock('@/server/http/handler', () => ({ defineRoute: <T>(handler: T) => handler }))
vi.mock('@/server/auth/session', () => ({ requireAdminSession: mocks.requireAdminSession }))
vi.mock('@/server/services/homepage-cover', () => ({ getHomepageCoverSettings: mocks.get, saveHomepageCoverSettings: mocks.save }))

import { GET, PUT } from './route'

const context = { params: Promise.resolve({}) }
const cover = { enabled: true, filePath: 'uploads/markdown/cover.png', positionX: 30, positionY: 50 }
function request(body = JSON.stringify(cover)) {
  return new NextRequest('http://localhost/api/admin/mm/homepage-cover', { method: 'PUT', body, headers: { 'content-type': 'application/json' } })
}

describe('admin homepage cover route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireAdminSession.mockResolvedValue(undefined)
    mocks.get.mockResolvedValue(cover)
    mocks.save.mockResolvedValue(cover)
  })

  it('requires administrator authorization for reading and writing before accessing settings', async () => {
    mocks.requireAdminSession.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }))
    await expect(GET(request(), context)).rejects.toMatchObject({ status: 403 })
    await expect(PUT(request(), context)).rejects.toMatchObject({ status: 403 })
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('reads and explicitly saves settings through the standard response envelope', async () => {
    const response = await GET(request(), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: cover })
    await PUT(request(), context)
    expect(mocks.save).toHaveBeenCalledWith(cover)
  })

  it('rejects malformed or oversized JSON without invoking persistence', async () => {
    await expect(PUT(request('{'), context)).rejects.toMatchObject({ status: 400 })
    await expect(PUT(request(' '.repeat(2049)), context)).rejects.toMatchObject({ status: 413 })
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
