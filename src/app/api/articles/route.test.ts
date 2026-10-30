import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

const getList = vi.hoisted(() => vi.fn())
vi.mock('@/server/http/handler', () => ({ defineRoute: <T>(handler: T) => handler }))
vi.mock('@/server/services/public-article-cache', () => ({ getCachedPublicArticleList: getList }))

import { GET } from './route'

const context = { params: Promise.resolve({}) }

describe('public article batches', () => {
  it('returns the cached requested batch in the shared API envelope', async () => {
    const batch = { list: [{ id: 'public-id', title: 'Article' }], page: 2, totalPages: 3 }
    getList.mockResolvedValueOnce(batch)
    const response = await GET(new NextRequest('http://localhost/api/articles?page=2'), context)
    expect(getList).toHaveBeenLastCalledWith(2)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ code: 0, message: 'ok', data: batch })
  })

  it.each(['0', '-1', '1.5', 'text', '1000001'])('rejects invalid page %s before querying', async (page) => {
    getList.mockClear()
    await expect(GET(new NextRequest(`http://localhost/api/articles?page=${page}`), context)).rejects.toThrow()
    expect(getList).not.toHaveBeenCalled()
  })
})
