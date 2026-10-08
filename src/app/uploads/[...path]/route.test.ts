import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '@/server/http/errors'
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), inspect: vi.fn(), read: vi.fn(), viewer: vi.fn() }))
vi.mock('@/server/auth/viewer', () => ({ getRequestViewer: mocks.viewer }))
vi.mock('@/server/services/file-access', () => ({ authorizeManagedFile: mocks.authorize }))
vi.mock('@/server/services/admin-files', () => ({ inspectPublicUpload: mocks.inspect, readPublicUpload: mocks.read }))
vi.mock('@/server/services/maintenance-lock', () => ({ withMaintenanceLock: (_mode: string, fn: () => unknown) => fn() }))
import { GET, HEAD } from './route'
const context = (path = ['docs', 'guide.pdf']) => ({ params: Promise.resolve({ path }) })
describe('protected upload GET and HEAD', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.viewer.mockResolvedValue(null)
    mocks.inspect.mockResolvedValue({ absolutePath: '/tmp/guide.pdf', fileName: 'guide.pdf', contentType: 'application/pdf', attachment: false, stats: { size: 4, mtime: new Date('2026-10-08') } })
    mocks.read.mockResolvedValue(Buffer.from('file'))
  })
  it.each([GET, HEAD])('authorizes before storage or conditional headers', async handler => {
    mocks.authorize.mockRejectedValue(new HttpError('Access denied', 401, 401))
    const response = await handler(new NextRequest('http://localhost/uploads/docs/guide.pdf', { headers: { 'If-None-Match': 'old', 'If-Modified-Since': 'Thu, 08 Oct 2026 00:00:00 GMT' } }), context())
    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.inspect).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('uses attachment disposition for downloads and no shared cache', async () => {
    const response = await GET(new NextRequest('http://localhost/uploads/docs/guide.pdf?projectId=2'), context())
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toContain('attachment;')
    expect(mocks.authorize).toHaveBeenCalledWith('uploads/docs/guide.pdf', null, { projectId: 2, download: true })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
  it('authorizes HEAD with the same rule and avoids reading file bytes', async () => {
    const response = await HEAD(new NextRequest('http://localhost/uploads/docs/guide.pdf', { method: 'HEAD' }), context())
    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
    expect(mocks.authorize).toHaveBeenCalledWith('uploads/docs/guide.pdf', null, { projectId: undefined, download: true })
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it.each([['%ZZ'], ['..', 'secret'], ['docs%2Fsecret'], ['docs%5Csecret'], ['%00']])('rejects unsafe segments %j before authorization', async (...segments) => {
    const response = await GET(new NextRequest('http://localhost/uploads/bad'), context(segments))
    expect(response.status).toBe(400)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })
  it('rejects a forged or invalid project identifier', async () => {
    expect((await GET(new NextRequest('http://localhost/uploads/docs/guide.pdf?projectId=-1'), context())).status).toBe(400)
    mocks.authorize.mockRejectedValue(new HttpError('Access denied', 403, 403))
    expect((await GET(new NextRequest('http://localhost/uploads/docs/guide.pdf?projectId=99'), context())).status).toBe(403)
    expect(mocks.inspect).not.toHaveBeenCalled()
  })
})
