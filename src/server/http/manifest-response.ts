/**
 * @file manifest-response.ts
 * @project SlothVault
 * @module Release Manifest HTTP
 * @description Builds byte-exact downloadable release manifest responses with integrity headers and conditional requests.
 * @logic Compare the caller's If-None-Match only after service-level authorization and integrity verification, then return either 304 or the stored canonical bytes.
 * @dependencies Web Response
 * @index_tags http,manifest,etag,sha256,download
 * @author holic512
 */
import 'server-only'

export function releaseManifestResponse(
  request: Request,
  release: { bytes: Uint8Array; releaseId: string; releaseHash: string },
) {
  const etag = `"${release.releaseHash}"`
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="slothvault-${release.releaseId}.manifest.json"`,
    'Content-Type': 'application/json; charset=utf-8',
    ETag: etag,
    'X-Content-SHA256': release.releaseHash,
  })
  const requestEtags = request.headers.get('if-none-match')
  if (
    requestEtags?.split(',').some((candidate) => {
      const normalized = candidate.trim()
      return normalized === '*' || normalized === etag || normalized === `W/${etag}`
    })
  ) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(Buffer.from(release.bytes), { status: 200, headers })
}
