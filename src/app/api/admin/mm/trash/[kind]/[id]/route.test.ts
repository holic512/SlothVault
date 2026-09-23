import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  restoreTrashItem: vi.fn(),
  getTrashPreview: vi.fn(),
  listTrashChildren: vi.fn(),
}))

vi.mock('@/server/http/handler', () => ({ defineRoute: <T>(handler: T) => handler }))
vi.mock('@/server/auth/session', () => ({ requireAdminSession: mocks.requireAdminSession }))
vi.mock('@/server/services/admin-trash', () => ({ restoreTrashItem: mocks.restoreTrashItem }))
vi.mock('@/server/services/admin-trash-read', () => ({ getTrashPreview: mocks.getTrashPreview, listTrashChildren: mocks.listTrashChildren }))

import { GET, POST } from './route'

const context = { params: Promise.resolve({ kind: 'content', id: '42' }) }

function request(query = '', method = 'GET') {
  const url = `http://localhost/api/admin/mm/trash/content/42${query}`
  return Object.assign(new Request(url, { method }), { nextUrl: new URL(url) })
}

describe('administrator trash item route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminSession.mockResolvedValue(undefined)
  })

  it('requires an administrator before reading or restoring', async () => {
    mocks.requireAdminSession.mockRejectedValue({ status: 403 })
    await expect(GET(request() as never, context)).rejects.toMatchObject({ status: 403 })
    await expect(POST(request('', 'POST') as never, context)).rejects.toMatchObject({ status: 403 })
    expect(mocks.getTrashPreview).not.toHaveBeenCalled()
    expect(mocks.restoreTrashItem).not.toHaveBeenCalled()
  })

  it('loads metadata and previews separately', async () => {
    mocks.listTrashChildren.mockResolvedValue([])
    mocks.getTrashPreview.mockResolvedValue({ content: '# Safe preview' })
    await GET(request('?view=children') as never, context)
    await GET(request() as never, context)
    expect(mocks.listTrashChildren).toHaveBeenCalledWith('content', 42)
    expect(mocks.getTrashPreview).toHaveBeenCalledWith('content', 42)
  })

  it('restores only through the dedicated endpoint and rejects unknown entity kinds', async () => {
    await POST(request('', 'POST') as never, context)
    expect(mocks.restoreTrashItem).toHaveBeenCalledWith('content', 42)
    await expect(POST(request('', 'POST') as never, { params: Promise.resolve({ kind: 'file', id: '42' }) }))
      .rejects.toMatchObject({ status: 400 })
    expect(mocks.restoreTrashItem).toHaveBeenCalledTimes(1)
  })
})
