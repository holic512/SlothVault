/**
 * @file managed-file-paths.ts
 * @project SlothVault
 * @module Managed Upload URL Contracts
 * @description Normalizes hosted file URLs and attaches explicit project context without changing source documents.
 * @logic Accept local uploads and a configured same-site origin, reject unsafe path segments, and leave external URLs intact.
 * @dependencies NEXT_PUBLIC_SITE_ORIGIN (optional canonical origin)
 * @index_tags files,urls,path-containment,read,download
 * @author holic512
 */
export function managedUploadPath(value: string | undefined, siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN) {
  if (!value || value.includes('\\')) return null
  try {
    let path = value
    if (!path.startsWith('/uploads/')) {
      if (!siteOrigin) return null
      const url = new URL(value)
      if (url.origin !== new URL(siteOrigin).origin || url.username || url.password) return null
      path = value.slice(value.indexOf('/', value.indexOf('://') + 3))
    }
    const decoded = decodeURIComponent(path.split(/[?#]/, 1)[0]).slice(1)
    if (!decoded.startsWith('uploads/') || /[\\\u0000]/.test(decoded) || decoded.split('/').some((part) => !part || part === '.' || part === '..')) return null
    return decoded
  } catch { return null }
}

export function isInlineImagePath(path: string) {
  return /\.(?:jpe?g|png|gif|webp|ico)$/i.test(path)
}

export function contextualFileUrl(value: string | undefined, projectId?: string, download = false) {
  const filePath = managedUploadPath(value)
  if (!filePath || !projectId) return value
  const query = new URLSearchParams({ projectId, ...(download ? { download: '1' } : {}) })
  return `/${filePath}?${query}`
}
