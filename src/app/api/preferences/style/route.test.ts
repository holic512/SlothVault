import { describe, expect, it, vi } from 'vitest'

vi.mock('@/server/http/handler', () => ({
  defineRoute: <T>(handler: T) => handler,
}))

import { POST } from '@/app/api/preferences/style/route'

const context = { params: Promise.resolve({}) }

describe('style preference route', () => {
  it('writes the selected supported style to a first-party cookie', async () => {
    const response = await POST(
      new Request('http://localhost/api/preferences/style', {
        method: 'POST',
        body: JSON.stringify({ style: 'saas' }),
      }) as never,
      context,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { style: 'saas' } })
    expect(response.headers.get('set-cookie')).toContain('sv_style=saas')
    expect(response.headers.get('set-cookie')).toContain('Path=/')
  })

  it('rejects an unsupported style without writing a cookie', async () => {
    const response = await POST(
      new Request('http://localhost/api/preferences/style', {
        method: 'POST',
        body: JSON.stringify({ style: 'neon' }),
      }) as never,
      context,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ message: 'Unsupported style' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
