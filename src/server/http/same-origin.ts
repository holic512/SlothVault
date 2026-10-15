/**
 * @file same-origin.ts
 * @project SlothVault
 * @module Browser Request Boundary
 * @description Validates same-origin browser mutations including TLS-terminating proxy deployments.
 * @logic Require an explicit canonical Origin and reject cross-site fetch metadata; only preserved Host plus same-origin metadata may reconcile the internal proxy scheme.
 * @dependencies next/server
 * @index_tags security,origin,csrf,proxy
 * @author holic512
 */
import type { NextRequest } from 'next/server'

export function isSameOriginRequest(request: NextRequest) {
  const origin = request.headers.get('origin'), site = request.headers.get('sec-fetch-site')
  if (!origin || (site && site !== 'same-origin')) return false
  try {
    const parsed = new URL(origin)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) return false
    if (origin === request.nextUrl.origin) return true
    // TLS-terminating proxies may change the internal scheme; only browser-confirmed
    // same-origin traffic with the preserved Host can use this compatibility path.
    return site === 'same-origin' && parsed.host === request.headers.get('host')
  } catch { return false }
}
