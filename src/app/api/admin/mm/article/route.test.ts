import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), get: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireAdminSession: mocks.session }))
vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: async () => ({ status: 'INSTALLED' }) }))
vi.mock('@/server/services/admin-articles', () => ({
  listAdminArticles: mocks.list, getAdminArticle: mocks.get,
  createAdminArticle: vi.fn(), updateAdminArticle: vi.fn(), deleteAdminArticle: vi.fn(),
}))

import { HttpError } from '@/server/http/errors'
import { GET } from './route'
import { GET as detail } from './[id]/route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ User: { id: 7 } })
  mocks.list.mockResolvedValue({ list: [{ id: '8', title: 'Guide', status: 0 }], page: 2, pageSize: 10, total: 11 })
  mocks.get.mockResolvedValue({ id: '8', title: 'Guide', content: '# Complete body' })
})

describe('administrator article collection/detail boundary', () => {
  it('passes bounded filters and pagination to the metadata list and reads editing bodies separately', async () => {
    const response = await GET(new NextRequest('https://vault.example/api/admin/mm/article?page=2&pageSize=10&keyword=%20Guide%20&status=0'), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith({ page: 2, pageSize: 10, skip: 10, keyword: 'Guide', status: 0 })
    const body = await response.json()
    expect(body.data.list[0]).not.toHaveProperty('content')
    const editing = await detail(new NextRequest('https://vault.example/api/admin/mm/article/8'), { params: Promise.resolve({ id: '8' }) })
    expect((await editing.json()).data.content).toBe('# Complete body')
    expect(mocks.get).toHaveBeenCalledWith(8)
  })

  it('requires administrator access for both collection and detail', async () => {
    mocks.session.mockRejectedValue(new HttpError('Forbidden', 403, 403))
    expect((await GET(new NextRequest('https://vault.example/api/admin/mm/article'), { params: Promise.resolve({}) })).status).toBe(403)
    expect((await detail(new NextRequest('https://vault.example/api/admin/mm/article/8'), { params: Promise.resolve({ id: '8' }) })).status).toBe(403)
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
  })
})
