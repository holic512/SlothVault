import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { readJson } from '@/server/http/request'

const contentSchema = z.object({ content: z.string() })

describe('readJson size constraints', () => {
  it('parses a bounded JSON body', async () => {
    const request = new NextRequest('http://localhost/api/document', {
      method: 'POST',
      body: JSON.stringify({ content: 'ok' }),
    })

    await expect(readJson(request, contentSchema, { maxBytes: 128 })).resolves.toEqual({
      content: 'ok',
    })
  })

  it('returns a payload-too-large error for a body beyond the measured limit', async () => {
    const request = new NextRequest('http://localhost/api/document', {
      method: 'POST',
      body: JSON.stringify({ content: 'oversized' }),
    })

    await expect(readJson(request, contentSchema, { maxBytes: 8 })).rejects.toMatchObject({
      status: 413,
      code: 413,
    })
  })
})
