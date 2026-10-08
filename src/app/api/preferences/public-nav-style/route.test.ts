import { describe, expect, it, vi } from 'vitest'

vi.mock('@/server/http/handler', () => ({
  defineRoute: <T>(handler: T) => handler,
}))

import { POST } from '@/app/api/preferences/public-nav-style/route'

const context = { params: Promise.resolve({}) }

describe('public navigation appearance preference route', () => {
  it('writes the selected supported appearance to a first-party cookie', async () => {
    const response = await POST(
      new Request('http://localhost/api/preferences/public-nav-style', {
        method: 'POST',
        body: JSON.stringify({ publicNavStyle: 'liquid-glass' }),
      }) as never,
      context,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { publicNavStyle: 'liquid-glass' } })
    expect(response.headers.get('set-cookie')).toContain('sv_public_nav_style=liquid-glass')
    expect(response.headers.get('set-cookie')).toContain('Path=/')
  })

  it('rejects unsupported appearances without writing a cookie', async () => {
    const response = await POST(
      new Request('http://localhost/api/preferences/public-nav-style', {
        method: 'POST',
        body: JSON.stringify({ publicNavStyle: 'crystal' }),
      }) as never,
      context,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ message: 'Unsupported public navigation appearance' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
