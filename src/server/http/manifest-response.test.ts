import { describe, expect, it } from 'vitest'

import { releaseManifestResponse } from '@/server/http/manifest-response'

const release = {
  bytes: Buffer.from('{"schema":1,"releaseId":"release"}', 'utf8'),
  releaseId: '550e8400-e29b-41d4-a716-446655440000',
  releaseHash: 'a'.repeat(64),
}

describe('release manifest response', () => {
  it('returns the exact canonical bytes and integrity headers', async () => {
    const response = releaseManifestResponse(new Request('https://example.test/manifest'), release)

    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(release.bytes)
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="slothvault-${release.releaseId}.manifest.json"`,
    )
    expect(response.headers.get('etag')).toBe(`"${release.releaseHash}"`)
    expect(response.headers.get('x-content-sha256')).toBe(release.releaseHash)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('honors an exact If-None-Match after the caller has resolved a release', async () => {
    const request = new Request('https://example.test/manifest', {
      headers: { 'If-None-Match': `"other", W/"${release.releaseHash}"` },
    })
    const response = releaseManifestResponse(request, release)

    expect(response.status).toBe(304)
    expect(await response.text()).toBe('')
    expect(response.headers.get('x-content-sha256')).toBe(release.releaseHash)
  })
})
